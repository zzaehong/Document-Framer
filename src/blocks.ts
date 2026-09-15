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
  const flush = (end: number) => {
    if (start < 0) return;
    const startOffset = lines[start].index!;
    const endOffset = lines[end].index! + lines[end][0].length;
    blocks.push({ id: `b${blocks.length + 1}`, kind, text: text.slice(startOffset, endOffset), source: { startLine: start + 1, endLine: end + 1, startOffset, endOffset } });
    start = -1;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i][0].replace(/[\r\n]+$/, '');
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
    if (!line.trim()) { flush(i - 1); continue; }
    if (/^ {0,3}#{1,6}(?:\s|$)/.test(line)) {
      flush(i - 1); start = i; kind = 'heading'; flush(i); continue;
    }
    if (start < 0) { start = i; kind = 'text'; }
  }
  flush(lines.length - 1);
  return blocks;
}
