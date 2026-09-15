/**
 * 평가 재현에 필요한 요청 설정·각 처리 규칙의 버전·원문 해시를 정의한다.
 * 해시는 같은 원문인지 비교하기 위한 식별값이며, 호출 기록에 원문 자체를 넣지 않는다.
 */
export const GENERATION_CONFIG = {
  responseMimeType: 'application/json', candidateCount: 1, temperature: 1,
  maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'minimal' },
} as const;
export interface EvaluationTrace {
  runId: string;
  purpose: 'connection' | 'classification';
  documentPath: string | null;
  sourceHash: string;
  hashEncoding: 'sha256-utf8-raw-v1';
  promptVersion: string;
  taxonomyVersion: string;
  segmenterVersion: string;
  responseSchemaVersion: 'classification-schema-v1';
  generationConfig: typeof GENERATION_CONFIG;
}
// 줄바꿈·공백을 정규화하지 않은 UTF-8 원문으로 SHA-256을 계산하고 16진수 문자열로 표현한다.
export async function sourceHash(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
