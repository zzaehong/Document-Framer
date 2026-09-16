/**
 * Concept 처리의 전체 순서와 완료 경계를 담당한다.
 * 입력/청크 사전 검사 → 청크별 추출 → 정확한 이름 병합 → 의미 통합 → 문서 분류 → Frame 조립.
 * 중간 응답은 이 실행의 지역 변수에만 둔다. 어느 필수 단계든 실패하면 Preview를 반환하지 않는다.
 */
import { Source, StructuralEngine } from './core';
import { DocumentMetadata } from './structure';
import { SEGMENTER_VERSION } from './blocks';
import { Classification, RESPONSE_SCHEMA, RESPONSE_SCHEMA_VERSION, TAXONOMY_VERSION, validateClassification } from './classification';
import { PROMPT_VERSION, SYSTEM_PROMPT } from './classification-prompt';
import { EXTRACTION_PROMPT, EXTRACTION_PROMPT_VERSION, CONSOLIDATION_PROMPT, CONSOLIDATION_PROMPT_VERSION } from './concept-prompts';
import { Domain, decodeDomains } from './domains';
import { GeminiClient } from './gemini';
import { MODEL } from './storage';
import { EvaluationTrace, GENERATION_CONFIG, sourceHash } from './evaluation';
import { buildContextUnits, CONTEXT_BUILDER_VERSION, ContextUnit } from './context';
import { BUDGET, PIPELINE_VERSION, budgetError, checkInputBudget } from './budget';
import { ConceptCandidate, Extraction, KnowledgeConcept, EXTRACTION_SCHEMA, CONCEPT_SCHEMA_VERSION, CONSOLIDATION_SCHEMA, CONSOLIDATION_SCHEMA_VERSION, CONSOLIDATION_VERSION, validateExtraction, mergeExactCandidates, needsSemanticConsolidation, validateConsolidation } from './concepts';

export interface PreviewFrame {
  schemaVersion: 5;
  engine: 'gemini';
  model: typeof MODEL;
  taxonomyVersion: typeof TAXONOMY_VERSION;
  generatedAt: string;
  previewOnly: true;
  evaluation: EvaluationTrace;
  modelVersion: string | null;
  processing: { chunkCount: number; completedChunks: number; calls: { trace: EvaluationTrace; modelVersion: string | null }[] };
  document: DocumentMetadata & { headings: { level: number; text: string; line: number }[]; importance: null } & Classification;
  concepts: KnowledgeConcept[];
}
export interface Preview { frame: PreviewFrame; sourceText: string; domainReviews: Record<string, 'approved' | 'rejected'> }
export class GeminiFramer {
  // transport 잠금은 HTTP 한 개를 보호한다. 이 잠금은 호출 사이의 await까지 포함한 문서 실행을 보호한다.
  private running = false;
  constructor(private client: GeminiClient) {}
  async generate(source: Source, key: string, existingDomains: readonly Domain[] = [], purpose: EvaluationTrace['purpose'] = 'classification', isValid = () => true, progress = (_message: string) => {}): Promise<Preview> {
    if (this.running) throw new Error('Gemini 문서 처리가 진행 중입니다. 완료 후 다시 요청하세요.');
    this.running = true;
    try {
      // 원문/Catalog를 실행 시작 시 고정한다. 이후 편집·승인이 이번 실행의 입력을 바꾸지 않는다.
      source = { ...source };
      const catalog = decodeDomains(existingDomains);
      if (new TextEncoder().encode(source.text).length > BUDGET.maxDocumentBytes) budgetError();
      const structuralFrame = await new StructuralEngine().generate(source);
      const metadata = structuralFrame.document;
      const chunks = await buildContextUnits(source.text, structuralFrame);
      if (!chunks.length) throw new Error('처리할 내용이 없습니다.');
      const inputs = chunks.map(chunk => ({ existingDomains: catalog, contextMarkdown: chunk.renderedMarkdown,
        // frontmatter는 일반 본문과 구분하되 관찰 신호로 Content Nature를 추론하지 않는다.
        frontmatterRanges: structuralFrame.structure.blocks.filter(b => b.kind === 'frontmatter' && chunk.blockIds.includes(b.id)).map(b => ({
          startOffset: chunk.headingWrapper.length ? chunk.headingWrapper.length + 2 + b.startOffset - chunk.sourceRanges[0].startOffset : b.startOffset - chunk.sourceRanges[0].startOffset,
          endOffset: (chunk.headingWrapper.length ? chunk.headingWrapper.length + 2 : 0) + b.endOffset - chunk.sourceRanges[0].startOffset,
        })) }));
      // 모든 추출 입력의 예산을 먼저 확인한다. 뒤쪽 청크가 크다는 이유로 앞부분만 유료 처리하지 않는다.
      inputs.forEach(checkInputBudget);
      const framingRunId = crypto.randomUUID();
      const hash = structuralFrame.sourceHash;
      const catalogHash = await sourceHash(JSON.stringify(catalog));
      const calls: PreviewFrame['processing']['calls'] = [];
      const ensureValid = () => { if (!isValid()) throw new Error('문서 요청이 종료되었습니다.'); };
      const call = async (stage: NonNullable<EvaluationTrace['stage']>, prompt: string, promptVersion: string, schema: unknown, schemaVersion: string, input: unknown, context?: ContextUnit) => {
        ensureValid(); checkInputBudget(input);
        if (calls.length >= BUDGET.maxLogicalRequests) budgetError();
        const trace: EvaluationTrace = {
          // 호출별 ID가 다르므로 각 호출의 첫 시도(:1)가 다른 청크 기록을 덮어쓰지 않는다.
          runId: `${framingRunId}:call-${calls.length + 1}`, framingRunId, purpose, stage, ...(context ? { chunkId: context.id, contextUnitId: context.id, sectionId: context.sectionId } : {}),
          documentPath: purpose === 'classification' ? source.path : null,
          sourceHash: hash, hashEncoding: 'sha256-utf8-raw-v1', promptVersion, responseSchemaVersion: schemaVersion,
          taxonomyVersion: TAXONOMY_VERSION, segmenterVersion: SEGMENTER_VERSION, chunkerVersion: CONTEXT_BUILDER_VERSION, structureVersion: structuralFrame.structureVersion,
          pipelineVersion: PIPELINE_VERSION, extractionPromptVersion: EXTRACTION_PROMPT_VERSION,
          conceptSchemaVersion: CONCEPT_SCHEMA_VERSION, consolidationVersion: CONSOLIDATION_VERSION,
          consolidationPromptVersion: CONSOLIDATION_PROMPT_VERSION, inputHash: await sourceHash(JSON.stringify(input)),
          domainCatalogHash: catalogHash, domainCatalogCount: catalog.length, domainCatalogEncoding: 'catalog-json-v1',
          generationConfig: GENERATION_CONFIG, processingBudget: BUDGET,
        };
        ensureValid();
        const response = await this.client.generate(key, prompt, input, schema, trace, isValid);
        ensureValid(); calls.push({ trace, modelVersion: response.modelVersion });
        return response.value;
      };
      const extractions: Extraction[] = [];
      let candidates: ConceptCandidate[] = [];
      progress(`개념 추출 준비 · ${chunks.length}개 청크 · 최대 ${chunks.length + (chunks.length > 1 ? 2 : 0)}회 요청 (재시도 별도)`);
      for (const [index, chunk] of chunks.entries()) {
        progress(`개념 추출 ${index + 1}/${chunks.length}`);
        const value = await call('concept-extraction', EXTRACTION_PROMPT, EXTRACTION_PROMPT_VERSION, EXTRACTION_SCHEMA, CONCEPT_SCHEMA_VERSION, inputs[index], chunk);
        const extraction = validateExtraction(value, catalog, chunk.id);
        extractions.push(extraction); candidates.push(...extraction.concepts);
        if (candidates.length > BUDGET.maxCandidates) budgetError();
      }
      // 원시 후보 수 제한은 병합 전에 적용한다. 중복이 많아도 처리 비용이 무한히 증가하지 않게 한다.
      candidates = mergeExactCandidates(candidates);
      if (needsSemanticConsolidation(candidates)) {
        progress('청크 간 개념 통합 중…');
        const value = await call('concept-consolidation', CONSOLIDATION_PROMPT, CONSOLIDATION_PROMPT_VERSION, CONSOLIDATION_SCHEMA, CONSOLIDATION_SCHEMA_VERSION,
          { candidates: candidates.map(({ candidateId, concept, chunkIds }) => ({ candidateId, concept, chunkIds })) });
        candidates = validateConsolidation(value, candidates);
      }
      // 긴 문서의 Domain/Content Nature는 모든 청크 신호로 한 번 결정한다. 원문 전체 재전송이나 첫 청크 편향을 피한다.
      let classification: Classification = { domains: extractions[0].domains, contentNature: extractions[0].contentNature };
      if (chunks.length > 1) {
        progress('문서 Domain·Content Nature 분류 중…');
        const value = await call('document-classification', SYSTEM_PROMPT, PROMPT_VERSION, RESPONSE_SCHEMA, RESPONSE_SCHEMA_VERSION,
          { existingDomains: catalog, chunks: extractions.map((item, index) => ({ chunkId: chunks[index].id, domains: item.domains, contentNature: item.contentNature, sourceBytes: chunks[index].sourceBytes, concepts: item.concepts.map(c => c.concept) })) });
        classification = validateClassification(value, catalog);
      }
      ensureValid();
      const local = { ...metadata, headings: structuralFrame.structure.sections.filter(s => s.level > 0).map(s => ({ level: s.level, text: s.title ?? '', line: s.startLine })), importance: null };
      const frame: PreviewFrame = {
        schemaVersion: 5, engine: 'gemini', model: MODEL, taxonomyVersion: TAXONOMY_VERSION,
        generatedAt: new Date().toISOString(), previewOnly: true, evaluation: calls[0].trace, modelVersion: calls[0].modelVersion,
        processing: { chunkCount: chunks.length, completedChunks: extractions.length, calls },
        document: { ...local, ...classification },
        concepts: candidates.map((candidate, index) => ({ id: `concept-${index + 1}`, concept: candidate.concept,
          confidence: candidate.confidence, highlight: false })),
      };
      return { frame, sourceText: source.text, domainReviews: Object.create(null) };
    } finally { this.running = false; }
  }
  // 연결 확인은 한 청크의 고정 문장으로 추출 응답까지 검증하며 사용자 문서를 사용하지 않는다.
  async checkConnection(key: string, existingDomains: readonly Domain[] = []) {
    await this.generate({ path: 'connection-test', basename: 'connection-test', ctime: 0, mtime: 0, text: 'An idea: keep brief project notes.' }, key, existingDomains, 'connection');
  }
}
