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
  responseSchemaVersion: string;
  // runId는 한 논리 API 호출, framingRunId는 문서 전체 처리 실행을 식별한다.
  framingRunId?: string;
  stage?: 'concept-extraction' | 'concept-consolidation' | 'document-classification';
  chunkId?: string;
  contextUnitId?: string;
  sectionId?: string;
  structureVersion?: string;
  chunkerVersion?: string;
  pipelineVersion?: string;
  extractionPromptVersion?: string;
  conceptSchemaVersion?: string;
  consolidationVersion?: string;
  consolidationPromptVersion?: string;
  inputHash?: string;
  processingBudget?: Readonly<Record<string, number>>;
  // 과거 v1 trace에는 없다. 추가 전용 Catalog의 prefix를 해시로 검증하여 재구성한다.
  domainCatalogHash?: string;
  domainCatalogCount?: number;
  domainCatalogEncoding?: 'catalog-json-v1';
  generationConfig: typeof GENERATION_CONFIG;
}
// 줄바꿈·공백을 정규화하지 않은 UTF-8 원문으로 SHA-256을 계산하고 16진수 문자열로 표현한다.
export async function sourceHash(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
