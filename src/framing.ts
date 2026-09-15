/**
 * Gemini 미리보기 조립 계층: 로컬 메타데이터 → 블록 분할 → API 호출 → 분류 검증 → Frame 조립.
 * 원문 위치와 제목은 로컬 코드가 계산하고, AI는 분야·종류·블록 묶음과 라벨을 결정한다.
 */
import { Source, Frame, TestEngine } from './core';
import { Block, extractBlocks, Location, SEGMENTER_VERSION } from './blocks';
import { Classification, DOMAINS, PROMPT_VERSION, RESPONSE_SCHEMA, SYSTEM_PROMPT, TAXONOMY_VERSION, validateClassification } from './classification';
import { GeminiClient } from './gemini';
import { MODEL } from './storage';
import { EvaluationTrace, GENERATION_CONFIG, sourceHash } from './evaluation';

// 단일 호출 비용/출력 크기를 제한하는 미리보기용 제안. 초과 시 일부만 보내지 않는다.
export const MAX_AI_BYTES = 64 * 1024;
export const MAX_BLOCKS = 128;
// schemaVersion 2는 AI 미리보기 결과이며 평가 추적 정보와 모델 버전을 포함한다.
export interface PreviewFrame {
  schemaVersion: 2;
  engine: 'gemini';
  model: typeof MODEL;
  taxonomyVersion: typeof TAXONOMY_VERSION;
  generatedAt: string;
  previewOnly: true;
  evaluation: EvaluationTrace;
  modelVersion: string | null;
  document: Omit<Frame['document'], 'domains' | 'type' | 'confidence'> & {
    domains: { id: string; path: readonly string[]; confidence: number }[];
    type: Classification['type'];
  };
  knowledgeUnits: { id: string; blockIds: string[]; source: Location; labels: Classification['units'][number]['labels']; highlight: false }[];
}
// 결과와 요청 당시 원문을 함께 보관해야 편집 후에도 당시의 위치를 정확히 보여줄 수 있다.
export interface Preview { frame: PreviewFrame; blocks: Block[]; sourceText: string }
export class GeminiFramer {
  constructor(private client: GeminiClient) {}
  async generate(source: Source, key: string, purpose: EvaluationTrace['purpose'] = 'classification', isValid = () => true): Promise<Preview> {
    // 로컬 입력 검사와 메타데이터 추출을 재사용하고 API 호출 전에 AI 전용 한도를 검사한다.
    const metadata = new TestEngine().generate(source).document;
    if (metadata.bytes > MAX_AI_BYTES) throw new Error('미리보기 입력 한도(64 KiB)를 초과했습니다. 문서를 나누어 다시 요청하세요.');
    const blocks = extractBlocks(source.text);
    if (!blocks.length || blocks.length > MAX_BLOCKS) throw new Error('미리보기 블록 한도(1~128개)를 벗어났습니다. 문서를 나누어 다시 요청하세요.');
    // 한 실행의 ID·원문 해시·처리 버전을 남겨 후속 평가에서 입력과 생성 조건을 구별한다.
    const evaluation: EvaluationTrace = { runId: crypto.randomUUID(), purpose, documentPath: purpose === 'classification' ? source.path : null,
      sourceHash: await sourceHash(source.text), hashEncoding: 'sha256-utf8-raw-v1', promptVersion: PROMPT_VERSION,
      taxonomyVersion: TAXONOMY_VERSION, segmenterVersion: SEGMENTER_VERSION, responseSchemaVersion: 'classification-schema-v1', generationConfig: GENERATION_CONFIG };
    // 원문 경로나 파일 시각 대신 블록 ID와 텍스트만 분류 입력으로 전송한다.
    const response = await this.client.generate(key, SYSTEM_PROMPT,
      { blocks: blocks.map(({ id, text }) => ({ id, text })) }, RESPONSE_SCHEMA, evaluation, isValid);
    const classification = validateClassification(response.value, blocks);
    const { domains: _domains, type: _type, confidence: _confidence, ...local } = metadata;
    const frame: PreviewFrame = {
      schemaVersion: 2, engine: 'gemini', model: MODEL, taxonomyVersion: TAXONOMY_VERSION,
      generatedAt: new Date().toISOString(), previewOnly: true, evaluation, modelVersion: response.modelVersion,
      document: { ...local, domains: classification.domains.map(a => ({ ...a, path: DOMAINS[a.id] })), type: classification.type },
      knowledgeUnits: classification.units.map((unit, i) => {
        // 검증된 연속 블록 묶음의 첫 시작점과 마지막 끝점으로 지식 단위의 원문 범위를 만든다.
        const first = blocks.find(b => b.id === unit.blockIds[0])!;
        const last = blocks.find(b => b.id === unit.blockIds.at(-1))!;
        return { id: `unit-${i + 1}`, blockIds: unit.blockIds,
          source: { startLine: first.source.startLine, endLine: last.source.endLine, startOffset: first.source.startOffset, endOffset: last.source.endOffset },
          labels: unit.labels, highlight: false };
      }),
    };
    return { frame, blocks, sourceText: source.text };
  }
  // 고정 테스트 문장을 같은 생성·검증 흐름에 통과시켜 연결과 응답 형식을 함께 확인한다.
  async checkConnection(key: string) {
    await this.generate({ path: 'connection-test', basename: 'connection-test', ctime: 0, mtime: 0, text: 'An idea: keep brief project notes.' }, key, 'connection');
  }
}
