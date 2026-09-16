/**
 * API의 최대 입력 크기가 아닌 이번 MVP의 비용·출력·대기 상한이다.
 * 청크를 16 KiB로 제한하여 한 응답에서 최대 16개 개념과 근거를 검토하도록 한다.
 * 실제 모델 품질을 측정하면 이 파일의 값과 PIPELINE_VERSION을 함께 갱신한다.
 */
export const PIPELINE_VERSION = 'concept-pipeline-v1';
export const BUDGET = {
  maxDocumentBytes: 512 * 1024,
  maxChunks: 32,
  maxChunkBytes: 16 * 1024,
  maxBlocksPerChunk: 64,
  minSectionBytes: 2 * 1024,
  maxConceptsPerChunk: 16,
  maxCandidates: 128,
  maxInputBytes: 96 * 1024,
  maxDocumentRequests: 1,
  maxConsolidationRequests: 1,
  maxLogicalRequests: 34,
  maxHttpAttempts: 68,
} as const;
export const byteLength = (text: string) => new TextEncoder().encode(text).length;
export function budgetError(): never {
  throw new Error('현재 Framing 처리 예산을 초과했습니다. 문서를 나누어 다시 요청하세요. 일부만 처리하지 않습니다.');
}
export function checkInputBudget(input: unknown) {
  if (byteLength(JSON.stringify(input)) > BUDGET.maxInputBytes) budgetError();
}
