/**
 * Concept/Evidence의 응답 계약과 통합 규칙. 모델에는 이름과 참조 ID만 맡긴다.
 * 원문 줄·offset 계산과 Evidence 결합은 이 파일에서 수행하므로 모델 요약문이 원문을 대체할 수 없다.
 */
import { Block, Location } from './blocks';
import { Classification, LABELS, RESPONSE_SCHEMA, validateClassification } from './classification';
import { Domain } from './domains';
import { BUDGET } from './budget';
export const CONCEPT_SCHEMA_VERSION = 'concept-extraction-schema-v1';
export const CONSOLIDATION_SCHEMA_VERSION = 'concept-consolidation-schema-v1';
export const CONSOLIDATION_VERSION = 'normalized-name-and-semantic-v1';
export interface SemanticAnnotation { id: typeof LABELS[number]; confidence: number }
export interface EvidenceSpan extends Location { blockIds: string[]; labels: SemanticAnnotation[] }
export interface KnowledgeConcept { id: string; concept: string; evidence: EvidenceSpan[]; confidence: number; highlight: boolean }
export interface ConceptCandidate { candidateId: string; concept: string; evidence: EvidenceSpan[]; confidence: number; chunkIds: string[] }
export interface Extraction extends Classification { concepts: ConceptCandidate[] }
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const confidence = { type: 'number', minimum: 0, maximum: 1 };
const nameSchema = { type: 'string', minLength: 1, maxLength: 120 };
const nonempty = (items: unknown) => ({ type: 'array', items, minItems: 1 });
export const EXTRACTION_SCHEMA = object({
  ...RESPONSE_SCHEMA.properties,
  concepts: { type: 'array', maxItems: BUDGET.maxConceptsPerChunk, items: object({ concept: nameSchema, confidence,
    evidence: nonempty(object({ blockIds: nonempty({ type: 'string' }), labels: nonempty(object({ id: { type: 'string', enum: LABELS }, confidence })) })) }) },
});
export const CONSOLIDATION_SCHEMA = object({ groups: nonempty(object({ concept: nameSchema, candidateIds: nonempty({ type: 'string' }) })) });
const fail = (): never => { throw new Error('Concept 응답 검증 실패: 개념 이름·Evidence·후보 참조를 확인하세요.'); };
function record(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== keys.length || keys.some(key => !Object.hasOwn(data, key))) return fail();
  return data;
}
function array(value: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) return fail();
  return value;
}
function score(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return fail();
  return value;
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 120 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) return fail();
  return value;
}
// 이름 정규화는 명확한 중복 판정에만 사용한다. 표시 이름은 첫 후보를 유지한다.
export const conceptKey = (value: string) => value.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ');
function labels(value: unknown): SemanticAnnotation[] {
  const result = array(value, 1, LABELS.length).map(value => {
    const r = record(value, ['id', 'confidence']);
    if (typeof r.id !== 'string' || !LABELS.includes(r.id as SemanticAnnotation['id'])) return fail();
    return { id: r.id as SemanticAnnotation['id'], confidence: score(r.confidence) };
  });
  if (new Set(result.map(a => a.id)).size !== result.length || (result.length > 1 && result.some(a => a.id === 'unclassified'))) return fail();
  return result;
}
function span(blocks: Block[], annotations: SemanticAnnotation[]): EvidenceSpan {
  const first = blocks[0], last = blocks.at(-1)!;
  return { blockIds: blocks.map(b => b.id), startLine: first.source.startLine, endLine: last.source.endLine,
    startOffset: first.source.startOffset, endOffset: last.source.endOffset, labels: annotations };
}

export function validateExtraction(value: unknown, blocks: Block[], catalog: readonly Domain[], chunkId: string): Extraction {
  const root = record(value, ['domains', 'type', 'concepts']);
  const classification = validateClassification({ domains: root.domains, type: root.type }, catalog);
  const positions = new Map(blocks.map((block, index) => [block.id, index]));
  const concepts = array(root.concepts, 0, BUDGET.maxConceptsPerChunk).map((value, index) => {
    const candidate = record(value, ['concept', 'confidence', 'evidence']);
    const used = new Set<string>();
    const evidence = array(candidate.evidence, 1, blocks.length).map(value => {
      const group = record(value, ['blockIds', 'labels']);
      let previous = -1;
      const selected = array(group.blockIds, 1, blocks.length).map(value => {
        if (typeof value !== 'string' || !positions.has(value) || used.has(value)) return fail();
        const position = positions.get(value)!;
        if (previous >= 0 && position !== previous + 1) return fail();
        previous = position; used.add(value);
        return blocks[position];
      });
      return span(selected, labels(group.labels));
    });
    // 그룹 간에는 비연속 Evidence를 허용하되 표시 순서는 원문 순서로 고정한다.
    evidence.sort((a, b) => a.startOffset - b.startOffset);
    return { candidateId: `${chunkId}:c${index + 1}`, concept: name(candidate.concept), confidence: score(candidate.confidence), evidence, chunkIds: [chunkId] };
  });
  return { ...classification, concepts };
}

/**
 * 같은 Concept을 합칠 때 원문 참조는 로컬에서 합친다. 부분 중복 그룹도 블록별로 정리한다.
 * 같은 라벨의 confidence는 보수적으로 최솟값을 남긴다. 명시적 역할이 있으면 unclassified를 제외한다.
 * 마지막에는 같은 라벨을 가진 인접 블록을 다시 묶어 원문 범위를 계산한다.
 */
function combine(items: ConceptCandidate[], concept: string, blocks: Block[]): ConceptCandidate {
  const annotations = new Map<string, Map<SemanticAnnotation['id'], number>>();
  for (const item of items) for (const evidence of item.evidence) for (const id of evidence.blockIds) {
    const merged = annotations.get(id) ?? new Map();
    for (const a of evidence.labels) merged.set(a.id, Math.min(merged.get(a.id) ?? 1, a.confidence));
    if (merged.size > 1) merged.delete('unclassified');
    annotations.set(id, merged);
  }
  const evidence: EvidenceSpan[] = [];
  let selected: Block[] = [], current: SemanticAnnotation[] = [], previous = -2;
  const flush = () => { if (selected.length) evidence.push(span(selected, current)); selected = []; };
  blocks.forEach((block, index) => {
    const roles = annotations.get(block.id);
    if (!roles) return;
    const next = [...roles].sort(([a], [b]) => a.localeCompare(b)).map(([id, confidence]) => ({ id, confidence }));
    if (index !== previous + 1 || JSON.stringify(next) !== JSON.stringify(current)) flush();
    selected.push(block); current = next; previous = index;
  });
  flush();
  return { candidateId: items[0].candidateId, concept, evidence, confidence: Math.min(...items.map(item => item.confidence)), chunkIds: [...new Set(items.flatMap(item => item.chunkIds))] };
}
export function mergeExactCandidates(candidates: ConceptCandidate[], blocks: Block[]): ConceptCandidate[] {
  const groups = new Map<string, ConceptCandidate[]>();
  for (const candidate of candidates) {
    const key = conceptKey(candidate.concept);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  return [...groups.values()].map(items => combine(items, items[0].concept, blocks));
}
export function needsSemanticConsolidation(candidates: ConceptCandidate[]): boolean {
  return candidates.length > 1 && new Set(candidates.flatMap(c => c.chunkIds)).size > 1;
}
export function validateConsolidation(value: unknown, candidates: ConceptCandidate[], blocks: Block[]): ConceptCandidate[] {
  const root = record(value, ['groups']);
  const byId = new Map(candidates.map(c => [c.candidateId, c]));
  const used = new Set<string>(), names = new Set<string>();
  const result = array(root.groups, 1, candidates.length).map(value => {
    const group = record(value, ['concept', 'candidateIds']);
    const concept = name(group.concept);
    if (names.has(conceptKey(concept))) return fail();
    names.add(conceptKey(concept));
    const members = array(group.candidateIds, 1, candidates.length).map(value => {
      if (typeof value !== 'string' || !byId.has(value) || used.has(value)) return fail();
      used.add(value); return byId.get(value)!;
    });
    if (members.length === 1 && concept !== members[0].concept) return fail();
    return combine(members, concept, blocks);
  });
  // 여기서의 완전 배분은 '추출된 후보' 보존이다. 모든 원문 블록을 배분하는 옛 규칙과 다르다.
  if (used.size !== candidates.length) return fail();
  return result;
}
