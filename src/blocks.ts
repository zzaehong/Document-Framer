/** Markdown 블록의 관찰 계층. text는 파싱 중에만 사용하며 저장 Frame에는 위치만 남긴다. */
export const SEGMENTER_VERSION = 'markdown-blocks-v2';
export interface Location { startLine: number; endLine: number; startOffset: number; endOffset: number }
export type StructuralBlockKind = 'paragraph' | 'heading' | 'list' | 'blockquote' | 'code' | 'table' | 'frontmatter' | 'horizontal-rule';
export interface Block { id: string; kind: StructuralBlockKind; text: string; source: Location; heading?: { level: number; title: string } }
export interface SourceLine { text: string; start: number; end: number }
export function sourceLines(text: string): SourceLine[] {
  return [...text.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)].filter(m => m[0].length > 0)
    .map(m => ({ text: m[0].replace(/(?:\r\n|\r|\n)$/, ''), start: m.index!, end: m.index! + m[0].length }));
}
export function sourceLocator(text: string) {
  const starts = [0, ...[...text.matchAll(/\r\n|\r|\n/g)].map(m => m.index! + m[0].length)];
  const lineAt = (offset: number) => {
    let low = 0, high = starts.length;
    while (low < high) { const mid = (low + high) >>> 1; if (starts[mid] <= offset) low = mid + 1; else high = mid; }
    return Math.max(1, low);
  };
  return (startOffset: number, endOffset: number): Location => ({ startOffset, endOffset, startLine: lineAt(startOffset), endLine: lineAt(Math.max(startOffset, endOffset - 1)) });
}
const listMarker = (s: string) => s.match(/^( {0,3})(?:[-+*]|\d{1,9}[.)])\s+/);
const rule = (s: string) => /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(s);
const fence = (s: string) => s.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
const atx = (s: string) => s.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/);
const tableDelimiter = (s: string) => s.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(s);

/** 원문 순서를 유지한다. 코드/인용/목록 내부 표지는 별도 heading으로 해석하지 않는다. */
export function extractBlocks(text: string): Block[] {
  const lines = sourceLines(text), blocks: Block[] = [];
  const emit = (kind: StructuralBlockKind, start: number, end: number, heading?: Block['heading']) => {
    const source = { startLine: start + 1, endLine: end, startOffset: lines[start].start, endOffset: lines[end - 1].end };
    blocks.push({ id: `b${blocks.length + 1}`, kind, text: text.slice(source.startOffset, source.endOffset), source, ...(heading ? { heading } : {}) });
  };
  const boundary = (i: number) => !lines[i].text.trim() || atx(lines[i].text) || fence(lines[i].text) || rule(lines[i].text)
    || listMarker(lines[i].text) || /^ {0,3}>/.test(lines[i].text);
  let i = 0;
  while (i < lines.length) {
    const start = i, line = lines[i].text;
    if (!line.trim()) { i++; continue; }
    if (i === 0 && /^\uFEFF?---\s*$/.test(line) && lines.slice(1).some(l => /^(---|\.\.\.)\s*$/.test(l.text))) {
      i++; while (i < lines.length && !/^(---|\.\.\.)\s*$/.test(lines[i].text)) i++;
      if (i < lines.length) i++;
      emit('frontmatter', start, i); continue;
    }
    const opening = fence(line);
    if (opening && (opening[1][0] !== '`' || !opening[2].includes('`'))) {
      i++;
      while (i < lines.length) {
        const close = lines[i++].text.match(/^ {0,3}(`+|~+)\s*$/);
        if (close && close[1][0] === opening[1][0] && close[1].length >= opening[1].length) break;
      }
      emit('code', start, i); continue;
    }
    if (/^(?: {4}|\t)/.test(line)) {
      i++; while (i < lines.length && (/^(?: {4}|\t)/.test(lines[i].text) || !lines[i].text.trim())) i++;
      emit('code', start, i); continue;
    }
    const heading = atx(line);
    if (heading) {
      emit('heading', i, ++i, { level: heading[1].length, title: (heading[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim() }); continue;
    }
    if (rule(line)) { emit('horizontal-rule', i, ++i); continue; }
    if (listMarker(line)) {
      i++;
      while (i < lines.length) {
        const next = lines[i].text;
        if (listMarker(next) && !rule(next) || /^(?: +|\t)\S/.test(next) || /^(?: {2,}|\t)/.test(next)) { i++; continue; }
        if (!next.trim()) {
          let look = i + 1; while (look < lines.length && !lines[look].text.trim()) look++;
          if (look < lines.length && (listMarker(lines[look].text) || /^(?: {2,}|\t)/.test(lines[look].text))) { i = look; continue; }
          break;
        }
        if (atx(next) || fence(next) || rule(next) || /^ {0,3}>/.test(next)) break;
        // blank 없이 이어지는 prose는 Markdown list item의 lazy continuation이다.
        i++;
      }
      emit('list', start, i); continue;
    }
    if (/^ {0,3}>/.test(line)) {
      i++;
      while (i < lines.length && (/^ {0,3}>/.test(lines[i].text) || (!boundary(i) && !/^(?: {4}|\t)/.test(lines[i].text)))) i++;
      emit('blockquote', start, i); continue;
    }
    if (i + 1 < lines.length && line.includes('|') && tableDelimiter(lines[i + 1].text)) {
      i += 2; while (i < lines.length && lines[i].text.trim() && lines[i].text.includes('|') && !atx(lines[i].text) && !fence(lines[i].text)) i++;
      emit('table', start, i); continue;
    }
    if (i + 1 < lines.length && /^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1].text)) {
      emit('heading', i, i + 2, { level: lines[i + 1].text.trim()[0] === '=' ? 1 : 2, title: line.trim() }); i += 2; continue;
    }
    i++;
    while (i < lines.length && !boundary(i)) {
      if (i + 1 < lines.length && (tableDelimiter(lines[i + 1].text) && lines[i].text.includes('|') || /^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1].text))) break;
      i++;
    }
    emit('paragraph', start, i);
  }
  return blocks;
}
