/**
 * 처리용 구조 청크를 만든다. 청크는 모델 입력을 제한하는 단위이며 사용자에게 보여주는 개념이 아니다.
 * 기존 Markdown 블록 추출을 사용하고 큰 블록만 추가 분할한다. 원문은 수정하지 않는다.
 * 반환하는 모든 블록의 offset은 전체 원문 기준이므로 청크별 응답을 안전하게 합칠 수 있다.
 */
import { Block, extractBlocks } from './blocks';
import { BUDGET, budgetError, byteLength } from './budget';
export const CHUNKER_VERSION = 'structural-chunks-v1';
export interface StructuralChunk { id: string; blocks: Block[]; bytes: number; headingContext: string[] }

export function structuralChunks(text: string): { blocks: Block[]; chunks: StructuralChunk[] } {
  if (byteLength(text) > BUDGET.maxDocumentBytes) budgetError();
  // 원문 줄 시작점을 한 번 계산한다. CRLF를 하나로 세고 단독 CR도 줄바꿈으로 다룬다.
  const starts = [0, ...[...text.matchAll(/\r\n|\r|\n/g)].map(match => match.index! + match[0].length)];
  const lineAt = (offset: number) => {
    let low = 0, high = starts.length;
    while (low < high) { const mid = (low + high) >>> 1; if (starts[mid] <= offset) low = mid + 1; else high = mid; }
    return low;
  };
  const blocks: Block[] = [];
  for (const block of extractBlocks(text)) {
    let start = 0;
    while (start < block.text.length) {
      // 코드 포인트 단위로 예산을 계산하여 emoji의 surrogate pair를 자르지 않는다.
      let end = start, bytes = 0, lastBreak = start;
      while (end < block.text.length) {
        const point = String.fromCodePoint(block.text.codePointAt(end)!);
        const width = byteLength(point);
        if (bytes + width > BUDGET.maxChunkBytes) break;
        bytes += width; end += point.length;
        if (point === '\n' || (point === '\r' && block.text[end] !== '\n')) lastBreak = end;
      }
      if (end < block.text.length) {
        if (lastBreak > start) end = lastBreak;
        else if (block.text[end - 1] === '\r' && block.text[end] === '\n') end--;
      }
      const startOffset = block.source.startOffset + start;
      const endOffset = block.source.startOffset + end;
      blocks.push({ id: `b${blocks.length + 1}`, kind: block.kind, text: text.slice(startOffset, endOffset),
        source: { startOffset, endOffset, startLine: lineAt(startOffset), endLine: lineAt(endOffset - 1) } });
      start = end;
    }
  }
  const pack = (preferHeadings: boolean) => {
    const chunks: StructuralChunk[] = [];
    let current: Block[] = [], bytes = 0, context: string[] = [], currentContext: string[] = [];
    const flush = () => {
      if (!current.length) return;
      chunks.push({ id: `chunk-${chunks.length + 1}`, blocks: current, bytes, headingContext: currentContext });
      current = []; bytes = 0;
    };
    for (const block of blocks) {
      const size = byteLength(block.text);
      // 적당히 큰 섹션은 새 Heading에서 끊고 작은 섹션은 이웃과 함께 처리한다.
      if ((preferHeadings && block.kind === 'heading' && bytes >= BUDGET.minSectionBytes)
        || bytes + size > BUDGET.maxChunkBytes || current.length === BUDGET.maxBlocksPerChunk) flush();
      if (block.kind === 'heading') {
        const heading = block.text.match(/^ {0,3}(#{1,6})\s*(.*)/);
        if (heading) { context = context.slice(0, heading[1].length - 1); context[heading[1].length - 1] = block.text; }
      }
      // 앞 청크에서 시작한 섹션의 Heading도 맥락으로 제공한다. 처리 블록은 청크 본문으로 한정한다.
      if (!current.length) currentContext = context.filter(Boolean);
      current.push(block); bytes += size;
    }
    flush();
    return chunks;
  };
  let chunks = pack(true);
  // 작은 Heading이 매우 많으면 섹션 경계만으로 호출 상한을 소진할 수 있다.
  // 이 경우 인접 섹션을 크기/블록 상한까지 다시 묶는다. 원문·블록·Heading 맥락은 유지한다.
  if (chunks.length > BUDGET.maxChunks) chunks = pack(false);
  if (chunks.length > BUDGET.maxChunks) budgetError();
  return { blocks, chunks };
}
