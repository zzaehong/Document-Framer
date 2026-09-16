/**
 * 문서 semantic index의 응답 계약과 통합 규칙. 모델에는 개념 이름과 통합 후보 ID만 맡긴다.
 * Concept은 이름·confidence만 받으며 원문 구간과 요약문은 생성하지 않는다.
 */
import { Classification, RESPONSE_SCHEMA, validateClassification } from './classification';
import { Domain } from './domains';
import { BUDGET } from './budget';
export const CONCEPT_SCHEMA_VERSION = 'concept-extraction-schema-v2';
export const CONSOLIDATION_SCHEMA_VERSION = 'concept-consolidation-schema-v1';
export const CONSOLIDATION_VERSION = 'normalized-name-and-semantic-v2';
export interface KnowledgeConcept { id: string; concept: string; confidence: number; highlight: boolean }
export interface ConceptCandidate { candidateId: string; concept: string; confidence: number; chunkIds: string[] }
export interface Extraction extends Classification { concepts: ConceptCandidate[] }
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const confidence = { type: 'number', minimum: 0, maximum: 1 };
const nameSchema = { type: 'string', minLength: 1, maxLength: 120 };
const nonempty = (items: unknown) => ({ type: 'array', items, minItems: 1 });
export const EXTRACTION_SCHEMA = object({
  ...RESPONSE_SCHEMA.properties,
  concepts: { type: 'array', maxItems: BUDGET.maxConceptsPerChunk, items: object({ concept: nameSchema, confidence }) },
});
export const CONSOLIDATION_SCHEMA = object({ groups: nonempty(object({ concept: nameSchema, candidateIds: nonempty({ type: 'string' }) })) });
const fail = (): never => { throw new Error('Concept 응답 검증 실패: 개념 이름·confidence 또는 통합 후보 형식을 확인하세요.'); };
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
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 120 || /[\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}]/u.test(value)) return fail();
  return value;
}
// 이름 정규화는 명확한 중복 판정에만 사용한다. 표시 이름은 첫 후보를 유지한다.
export const conceptKey = (value: string) => value.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ');
// 원문 블록은 처리 입력일 뿐 Concept의 근거 참조가 아니다. 이름과 confidence만 검증한다.
export function validateExtraction(value: unknown, catalog: readonly Domain[], chunkId: string): Extraction {
  const root = record(value, ['domains', 'contentNature', 'concepts']);
  const classification = validateClassification({ domains: root.domains, contentNature: root.contentNature }, catalog);
  const concepts = array(root.concepts, 0, BUDGET.maxConceptsPerChunk).map((value, index) => {
    const candidate = record(value, ['concept', 'confidence']);
    return { candidateId: `${chunkId}:c${index + 1}`, concept: name(candidate.concept), confidence: score(candidate.confidence), chunkIds: [chunkId] };
  });
  return { ...classification, concepts };
}

// 동일 개념의 후보 출처만 결합하고 confidence는 보수적으로 최솟값을 유지한다.
function combine(items: ConceptCandidate[], concept: string): ConceptCandidate {
  return { candidateId: items[0].candidateId, concept, confidence: Math.min(...items.map(item => item.confidence)), chunkIds: [...new Set(items.flatMap(item => item.chunkIds))] };
}
export function mergeExactCandidates(candidates: ConceptCandidate[]): ConceptCandidate[] {
  const groups = new Map<string, ConceptCandidate[]>();
  for (const candidate of candidates) {
    const key = conceptKey(candidate.concept);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  return [...groups.values()].map(items => combine(items, items[0].concept));
}
export function needsSemanticConsolidation(candidates: ConceptCandidate[]): boolean {
  return candidates.length > 1 && new Set(candidates.flatMap(c => c.chunkIds)).size > 1;
}
export function validateConsolidation(value: unknown, candidates: ConceptCandidate[]): ConceptCandidate[] {
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
    return combine(members, concept);
  });
  // 여기서의 완전 배분은 '추출된 후보' 보존이다. 모든 원문 블록을 배분하는 옛 규칙과 다르다.
  if (used.size !== candidates.length) return fail();
  return result;
}
