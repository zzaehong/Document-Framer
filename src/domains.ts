/** Domain 경로의 공통 계약. 저장소와 AI 응답이 같은 정규화·동일성 규칙을 사용한다. */
export interface Domain { path: string[] }
export const MAX_DOMAIN_DEPTH = 3;
export const MAX_DOMAIN_NAME = 80;

// 비교에만 소문자를 사용한다. 실제 응답이나 저장된 표시 이름을 조용히 수정하지 않는다.
export const domainKey = (path: readonly string[]) => JSON.stringify(path.map(part => part.toLowerCase()));
export const isOther = (path: readonly string[]) => path.some(part => part.toLowerCase() === 'other');
export function validateDomainPath(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_DOMAIN_DEPTH
    || value.some(part => typeof part !== 'string' || !part.length || part.length > MAX_DOMAIN_NAME
      || part !== part.normalize('NFC') || part !== part.trim().replace(/\s+/gu, ' ')
      || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(part))) throw new Error('Domain 경로 검증 실패');
  const path = value as string[];
  if (new Set(path.map(part => part.toLowerCase())).size !== path.length) throw new Error('Domain 계층 검증 실패');
  return [...path];
}
export function decodeDomains(value: unknown): Domain[] {
  if (!Array.isArray(value)) throw new Error('Domain Catalog 검증 실패');
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Object.keys(item).length !== 1 || !Object.hasOwn(item, 'path')) throw new Error('Domain Catalog 검증 실패');
    const path = validateDomainPath(item.path);
    const key = domainKey(path);
    if (isOther(path) || seen.has(key)) throw new Error('Domain Catalog 중복 또는 예약 경로');
    seen.add(key);
    return { path };
  });
}
