/**
 * Markdown 원문을 제목·본문·코드·프런트매터 블록으로 나누는 계층.
 * AI에는 블록 ID와 텍스트를 보내고, 결과의 원문 위치는 여기서 계산한 범위를 사용한다.
 */
export const SEGMENTER_VERSION = 'markdown-blocks-v1';
export interface Location { startLine: number; endLine: number; startOffset: number; endOffset: number }
export interface Block { id: string; kind: 'heading' | 'text' | 'code' | 'frontmatter'; text: string; source: Location }

/** 정규화 없이 원문을 자른다. 줄은 1부터, offset은 UTF-16의 [start, end) 범위다. */
export function extractBlocks(text: string): Block[] {
  const lines = [...text.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)].filter(m => m[0].length > 0);
  const blocks: Block[] = [];
  let start = -1;
  let kind: Block['kind'] = 'text';
  let fence: { char: string; length: number } | null = null;
  let frontmatter = false;
  // 지금까지 모은 줄을 원문의 연속 범위로 확정한다. 다음 블록 ID는 원문 순서대로 부여한다.
  const flush = (end: number) => {
    if (start < 0) return;
    const startOffset = lines[start].index!;
    const endOffset = lines[end].index! + lines[end][0].length;
    blocks.push({ id: `b${blocks.length + 1}`, kind, text: text.slice(startOffset, endOffset), source: { startLine: start + 1, endLine: end + 1, startOffset, endOffset } });
    start = -1;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i][0].replace(/[\r\n]+$/, '');
    // 프런트매터와 코드 내부는 빈 줄·제목처럼 보여도 별도 블록으로 쪼개지 않는다.
    if (frontmatter) {
      if (/^(---|\.\.\.)\s*$/.test(line)) { frontmatter = false; flush(i); }
      continue;
    }
    if (fence) {
      const close = line.match(/^ {0,3}(`+|~+)\s*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) { fence = null; flush(i); }
      continue;
    }
    if (i === 0 && /^\uFEFF?---\s*$/.test(line)) { start = i; kind = 'frontmatter'; frontmatter = true; continue; }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (opening && (opening[1][0] !== '`' || !opening[2].includes('`'))) {
      flush(i - 1); start = i; kind = 'code'; fence = { char: opening[1][0], length: opening[1].length }; continue;
    }
    // 일반 본문은 빈 줄에서 끝내고, 제목은 한 줄짜리 독립 블록으로 만든다.
    if (!line.trim()) { flush(i - 1); continue; }
    if (/^ {0,3}#{1,6}(?:\s|$)/.test(line)) {
      flush(i - 1); start = i; kind = 'heading'; flush(i); continue;
    }
    if (start < 0) { start = i; kind = 'text'; }
  }
  // 파일 끝까지 닫히지 않은 코드·프런트매터도 남은 원문을 버리지 않고 확정한다.
  flush(lines.length - 1);
  return blocks;
}
