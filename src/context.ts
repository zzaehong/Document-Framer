/**
 * 저장 구조와 모델 입력을 분리한다. Section subtree가 들어가면 보존하고,
 * 초과할 때만 child section → direct blocks → 안전한 내부 경계 순서로 분해한다.
 */
import { Location, sourceLines, sourceLocator } from './blocks';
import { BUDGET, byteLength, budgetError } from './budget';
import { StructuralFrame, SectionInfo } from './structure';
import { sourceHash } from './evaluation';
export const CONTEXT_BUILDER_VERSION = 'section-context-v1';
export interface ContextBudget { maxBytes: number; maxBlocks: number; maxUnits: number; minSectionBytes: number }
export const CONTEXT_BUDGET: ContextBudget = {
  maxBytes: BUDGET.maxChunkBytes, maxBlocks: BUDGET.maxBlocksPerChunk, maxUnits: BUDGET.maxChunks, minSectionBytes: BUDGET.minSectionBytes,
};
export interface ContextUnit {
  id: string; sectionId: string; sectionIds: string[]; headingPath: string[];
  sourceRanges: Location[]; sourceBytes: number; byteLength: number;
  blockIds: string[]; headingWrapper: string; renderedMarkdown: string;
}
interface Piece { section: SectionInfo; start: number; end: number; sectionIds: string[] }
const extend = (piece: Piece | null, end: number): Piece | null => piece ? { ...piece, end } : null;
export async function buildContextUnits(source: string, frame: StructuralFrame, budget: ContextBudget = CONTEXT_BUDGET): Promise<ContextUnit[]> {
  if (frame.sourceHash !== await sourceHash(source)) throw new Error('Structural Frame과 원문 버전이 다릅니다. 로컬 Framing을 다시 실행하세요.');
  if (![budget.maxBytes, budget.maxBlocks, budget.maxUnits].every(n => Number.isSafeInteger(n) && n > 0)
    || !Number.isFinite(budget.minSectionBytes) || budget.minSectionBytes < 0) throw new Error('Context 예산이 올바르지 않습니다.');
  const { sections, blocks } = frame.structure;
  const byId = new Map(sections.map(s => [s.id, s]));
  const locate = sourceLocator(source);
  const intersect = (p: Piece) => blocks.filter(b => b.startOffset < p.end && b.endOffset > p.start);
  const wrapper = (p: Piece) => {
    const ancestors: SectionInfo[] = [];
    for (let s: SectionInfo | undefined = p.section; s?.parentId; s = byId.get(s.parentId)) ancestors.unshift(s);
    return ancestors.filter(s => {
      const heading = blocks.find(b => b.sectionId === s.id && b.kind === 'heading');
      return !heading || heading.startOffset < p.start || heading.endOffset > p.end;
    }).map(s => `${'#'.repeat(s.level)} ${s.title ?? ''}`).join('\n');
  };
  const rendered = (p: Piece) => { const prefix = wrapper(p); return `${prefix ? prefix + '\n\n' : ''}${source.slice(p.start, p.end)}`; };
  const fits = (p: Piece) => intersect(p).length <= budget.maxBlocks && byteLength(rendered(p)) <= budget.maxBytes;
  const pieces: Piece[] = [];
  const add = (p: Piece) => { if (p.end > p.start) pieces.push(p); };
  const atomicError = (kind: string) => { throw new Error(`Context 예산을 초과한 ${kind} 블록입니다. 원문 블록을 나누거나 예산을 조정하세요. 일부만 처리하지 않습니다.`); };
  // paragraph/item의 마지막 수단. 문장·줄을 선호하고 UTF-16 surrogate 및 CRLF를 자르지 않는다.
  const splitText = (p: Piece, preferLines = false) => {
    let start = p.start;
    while (start < p.end) {
      const current = { ...p, start };
      const prefix = wrapper(current);
      const available = budget.maxBytes - byteLength(prefix ? prefix + '\n\n' : '');
      if (available <= 0) atomicError('heading context');
      let end = start, bytes = 0, sentence = start, line = start;
      while (end < p.end) {
        const point = String.fromCodePoint(source.codePointAt(end)!);
        const width = byteLength(point); if (bytes + width > available) break;
        bytes += width; end += point.length;
        if (/[.!?。！？]/u.test(point) && (end === p.end || /\s/u.test(source[end]))) sentence = end;
        if (point === '\n' || point === '\r' && source[end] !== '\n') line = end;
      }
      if (end < p.end) {
        if (preferLines && line > start) end = line;
        else if (sentence > start) end = sentence;
        else if (line > start) end = line;
        else if (source[end - 1] === '\r' && source[end] === '\n') end--;
      }
      if (end <= start) atomicError('문자/heading context');
      const next = { ...p, start, end };
      if (!fits(next)) atomicError('구조');
      add(next); start = end;
    }
  };
  const splitBlock = (p: Piece, kind: string) => {
    if (['code', 'table', 'frontmatter', 'heading'].includes(kind)) atomicError(kind);
    if (kind !== 'list') { splitText(p, kind === 'blockquote'); return; }
    // 최상위 marker의 최소 들여쓰기를 기준으로 nested item을 부모와 묶는다.
    const markers = sourceLines(source.slice(p.start, p.end)).map(l => ({ offset: p.start + l.start, match: l.text.match(/^( *)(?:[-+*]|\d{1,9}[.)])\s+/) })).filter(l => l.match);
    const indent = Math.min(...markers.map(l => l.match![1].length));
    const boundaries = [p.start, ...markers.filter(l => l.match![1].length === indent && l.offset > p.start).map(l => l.offset), p.end];
    let pending: Piece | null = null;
    for (let i = 0; i + 1 < boundaries.length; i++) {
      const item = { ...p, start: boundaries[i], end: boundaries[i + 1] };
      if (!fits(item)) { if (pending) add(pending); pending = null; splitText(item); continue; }
      const merged = extend(pending, item.end);
      if (merged && fits(merged)) pending = merged;
      else { if (pending) add(pending); pending = item; }
    }
    if (pending) add(pending);
  };
  const packBlocks = (section: SectionInfo, start: number, end: number) => {
    if (start >= end) return;
    const p = { section, start, end, sectionIds: [section.id] };
    if (fits(p)) { add(p); return; }
    const members = intersect(p);
    if (!members.length) { splitText(p); return; }
    let pending: Piece | null = null;
    for (let i = 0; i < members.length; i++) {
      const atom = { ...p, start: i === 0 ? start : members[i].startOffset, end: i + 1 < members.length ? members[i + 1].startOffset : end };
      if (!fits(atom)) {
        if (pending) add(pending); pending = null; splitBlock(atom, members[i].kind); continue;
      }
      const merged = extend(pending, atom.end);
      if (merged && fits(merged)) pending = merged;
      else { if (pending) add(pending); pending = atom; }
      // 수평선은 약한 경계다. 예산으로 분해할 때만 다음 흐름과 구분한다.
      if (members[i].kind === 'horizontal-rule' && pending) { add(pending); pending = null; }
    }
    if (pending) add(pending);
  };
  const visit = (section: SectionInfo) => {
    const p = { section, start: section.startOffset, end: section.endOffset, sectionIds: [section.id] };
    if ((section.parentId !== null || !section.childIds.length) && fits(p)) { add(p); return; }
    let cursor = section.startOffset;
    for (const id of section.childIds) {
      const child = byId.get(id)!;
      packBlocks(section, cursor, child.startOffset); visit(child); cursor = child.endOffset;
    }
    packBlocks(section, cursor, section.endOffset);
  };
  visit(sections[0]);
  // 같은 부모의 작은 인접 섹션만 병합한다. 서로 다른 H1 주제는 합치지 않는다.
  const merged: Piece[] = [];
  for (const p of pieces) {
    const previous = merged.at(-1);
    const small = (section: SectionInfo) => section.level > 1 && section.byteLength < budget.minSectionBytes;
    const previousSections = previous?.sectionIds.map(id => byId.get(id)!) ?? [];
    const compatible = previous && previous.end === p.start && p.start === p.section.startOffset && p.end === p.section.endOffset
      && small(p.section) && previousSections.every(s => small(s) && s.parentId === p.section.parentId)
      && previous.start === previousSections[0].startOffset && previous.end === previousSections.at(-1)!.endOffset;
    const parent = compatible ? byId.get(p.section.parentId!) : undefined;
    const candidate = parent && previous ? { section: parent, start: previous.start, end: p.end, sectionIds: [...previous.sectionIds, ...p.sectionIds] } : null;
    if (candidate && fits(candidate)) merged[merged.length - 1] = candidate;
    else merged.push(p);
  }
  if (merged.length > budget.maxUnits) budgetError();
  return merged.map((p, index) => ({ id: `context-${index + 1}`, sectionId: p.section.id, sectionIds: p.sectionIds,
    headingPath: p.section.headingPath, sourceRanges: [locate(p.start, p.end)], sourceBytes: byteLength(source.slice(p.start, p.end)),
    byteLength: byteLength(rendered(p)), blockIds: intersect(p).map(b => b.id), headingWrapper: wrapper(p), renderedMarkdown: rendered(p) }));
}
