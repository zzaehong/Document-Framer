/**
 * API의 최대 입력 크기가 아닌 이번 MVP의 비용·출력·대기 상한이다.
 * 청크를 16 KiB로 제한하여 한 응답에서 최대 16개 개념을 검토하도록 한다.
 * 실제 모델 품질을 측정하면 이 파일의 값과 PIPELINE_VERSION을 함께 갱신한다.
 */
export const PIPELINE_VERSION = 'concept-pipeline-v2';
// 논리 호출과 HTTP 전송 예산이 어긋나지 않도록 transport와 UI가 같은 상수를 사용한다.
export const MAX_HTTP_ATTEMPTS = 3;
export const RETRY_BASE_MS = 1500;
export const RETRY_JITTER_MS = 500;
export const RETRY_MAX_MS = 5000;
const MAX_CHUNKS = 32;
const MAX_DOCUMENT_REQUESTS = 1;
const MAX_CONSOLIDATION_REQUESTS = 1;
const MAX_LOGICAL_REQUESTS = MAX_CHUNKS + MAX_DOCUMENT_REQUESTS + MAX_CONSOLIDATION_REQUESTS;
export const BUDGET = {
  maxDocumentBytes: 512 * 1024,
  maxChunks: MAX_CHUNKS,
  maxChunkBytes: 16 * 1024,
  maxBlocksPerChunk: 64,
  minSectionBytes: 2 * 1024,
  maxConceptsPerChunk: 16,
  maxCandidates: 128,
  maxInputBytes: 96 * 1024,
  maxDocumentRequests: MAX_DOCUMENT_REQUESTS,
  maxConsolidationRequests: MAX_CONSOLIDATION_REQUESTS,
  maxLogicalRequests: MAX_LOGICAL_REQUESTS,
  maxHttpAttempts: MAX_LOGICAL_REQUESTS * MAX_HTTP_ATTEMPTS,
} as const;
export const byteLength = (text: string) => new TextEncoder().encode(text).length;
export function budgetError(): never {
  throw new Error('현재 Framing 처리 예산을 초과했습니다. 문서를 나누어 다시 요청하세요. 일부만 처리하지 않습니다.');
}
export function checkInputBudget(input: unknown) {
  if (byteLength(JSON.stringify(input)) > BUDGET.maxInputBytes) budgetError();
}
