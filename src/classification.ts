/**
 * AI 분류 계약: Domain 경로·출처와 Type/Label의 응답 스키마 → 실제 값 검증.
 * Domain은 문서 분야, Type은 문서 종류, Label은 지식 단위의 역할을 뜻한다.
 */
import { Domain, decodeDomains, domainKey, isOther, validateDomainPath, MAX_DOMAIN_DEPTH, MAX_DOMAIN_NAME } from './domains';

// 고정 Domain 목록이 아니라 Domain 정책 및 기존 Type/Label 초안의 버전이다.
export const TAXONOMY_VERSION = 'domain-policy-v1/type-label-draft-0.1';
export const RESPONSE_SCHEMA_VERSION = 'document-classification-schema-v3';
export interface DomainClassification extends Domain { source: 'existing' | 'new' | 'unclassified'; confidence: number }
export const TYPES = ['informational', 'idea-note', 'prose-with-decision', 'prose-without-decision', 'unclassified'] as const;
export const LABELS = ['claim', 'evidence', 'conclusion', 'idea', 'observation', 'decision', 'context', 'unclassified'] as const;
// AI 응답에는 로컬 메타데이터 대신 분류값과 원문 블록 참조만 허용한다.
export interface Classification {
  domains: DomainClassification[];
  type: { id: typeof TYPES[number]; confidence: number };
}
const confidence = { type: 'number', minimum: 0, maximum: 1 };
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const list = (items: unknown) => ({ type: 'array', items, minItems: 1 });
const annotation = (ids: readonly string[]) => object({ id: { type: 'string', enum: ids }, confidence });
// 모델에 요구할 출력 모양. 수신 뒤에도 아래 검증 함수로 실제 값을 다시 검사한다.
export const RESPONSE_SCHEMA = object({
  domains: list(object({ path: { type: 'array', items: { type: 'string', minLength: 1, maxLength: MAX_DOMAIN_NAME }, minItems: 1, maxItems: MAX_DOMAIN_DEPTH }, source: { type: 'string', enum: ['existing', 'new', 'unclassified'] }, confidence })),
  type: annotation(TYPES),
});
// unknown 응답을 신뢰 가능한 Classification으로 바꾸는 경계. 오류를 임의 보정하지 않고 거부한다.
export function validateClassification(value: unknown, existingDomains: readonly Domain[] = []): Classification {
  const invalid = () => { throw new Error('분류 응답 검증 실패: taxonomy, confidence 또는 블록 참조가 올바르지 않습니다.'); };
  // 필수 키 누락뿐 아니라 예상하지 않은 추가 키도 거부한다.
  const record = (v: unknown, keys: string[]): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return invalid();
    const r = v as Record<string, unknown>;
    if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r, k))) return invalid();
    return r;
  };
  const array = (v: unknown): unknown[] => Array.isArray(v) && v.length ? v : invalid();
  const checkedAnnotation = (v: unknown, ids: readonly string[]) => {
    const r = record(v, ['id', 'confidence']);
    if (typeof r.id !== 'string' || !ids.includes(r.id) || typeof r.confidence !== 'number' || !Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 1) return invalid();
    return { id: r.id, confidence: r.confidence };
  };
  const root = record(value, ['domains', 'type']);
  const catalog = decodeDomains(existingDomains);
  const seen = new Set<string>();
  const domains = array(root.domains).map(value => {
    const r = record(value, ['path', 'source', 'confidence']);
    const path = validateDomainPath(r.path);
    const key = domainKey(path);
    if (seen.has(key) || typeof r.confidence !== 'number' || !Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 1) return invalid();
    seen.add(key);
    const existing = catalog.find(domain => domainKey(domain.path) === key);
    if (isOther(path)) {
      if (JSON.stringify(path) !== '["Other"]' || r.source !== 'unclassified' || (root.domains as unknown[]).length !== 1) return invalid();
    } else if (r.source === 'existing') {
      // 요청 당시 Catalog 표기와 완전히 일치해야 한다. 대소문자를 임의로 고치지 않는다.
      if (!existing || JSON.stringify(existing.path) !== JSON.stringify(path)) return invalid();
    } else if (r.source !== 'new' || existing) return invalid();
    return { path, source: r.source, confidence: r.confidence } as DomainClassification;
  });
  const type = checkedAnnotation(root.type, TYPES);
  return { domains, type } as Classification;
}
