/** Phase 1 저장 모델. 구조는 원문 위치만 보관하며 본문은 복제하지 않는다. */
import { extractBlocks, Location, sourceLocator, StructuralBlockKind, SEGMENTER_VERSION } from './blocks';
import { sourceHash } from './evaluation';
import { byteLength } from './budget';
import type { Source } from './core';
export const STRUCTURAL_SCHEMA_VERSION = 6;
export const STRUCTURE_VERSION = 'markdown-structure-v1';
export const MAX_LOCAL_BYTES = 2 * 1024 * 1024;
export interface SectionInfo extends Location {
  id: string; level: number; title: string | null; headingPath: string[];
  parentId: string | null; childIds: string[]; byteLength: number; blockIds: string[];
}
export interface StructuralBlock extends Location { id: string; kind: StructuralBlockKind; sectionId: string; byteLength: number }
export interface StructuralStats {
  headingCount: number; sectionCount: number; paragraphCount: number; listCount: number;
  blockquoteCount: number; codeBlockCount: number; tableCount: number; linkCount: number; externalLinkCount: number;
}
export interface GroundingSignals {
  externalLinkCount: number; footnoteReferenceCount: number; blockquoteCount: number;
  tableCount: number; referenceSectionCount: number; sourceMetadataKeys: string[];
}
export interface DocumentMetadata {
  path: string; title: string; createdAt: number; modifiedAt: number; bytes: number; lineCount: number;
}
export interface StructuralFrame {
  schemaVersion: 6; engine: 'local-structural-v1'; generatedAt: string;
  sourceHash: string; hashEncoding: 'sha256-utf8-raw-v1'; parserVersion: string; structureVersion: string;
  document: DocumentMetadata;
  structure: { sections: SectionInfo[]; blocks: StructuralBlock[]; stats: StructuralStats };
  groundingSignals: GroundingSignals; semantic: { status: 'not-run' };
}
// legacy는 복원만 하며 새 생성 경로에서는 사용하지 않는다. 알 수 없는 이전 필드도 보존한다.
export interface LegacyFrame { schemaVersion: number; engine?: string; document?: Record<string, unknown>; [key: string]: unknown }
export type StoredFrame = StructuralFrame | LegacyFrame;
export function isStructuralFrame(frame: StoredFrame): frame is StructuralFrame {
  return frame.schemaVersion === STRUCTURAL_SCHEMA_VERSION && frame.engine === 'local-structural-v1' && 'structure' in frame;
}

export function parseMarkdownStructure(source: string): Pick<StructuralFrame, 'structure' | 'groundingSignals'> {
  const parsed = extractBlocks(source), locate = sourceLocator(source);
  const root: SectionInfo = { id: 'section-root', level: 0, title: null, headingPath: [], parentId: null, childIds: [], blockIds: [], byteLength: byteLength(source), ...locate(0, source.length) };
  const sections = [root], stack = [root], blocks: StructuralBlock[] = [];
  const close = (section: SectionInfo, end: number) => {
    Object.assign(section, locate(section.startOffset, end));
    section.byteLength = byteLength(source.slice(section.startOffset, end));
  };
  for (const block of parsed) {
    if (block.heading) {
      while (stack.length > 1 && stack.at(-1)!.level >= block.heading.level) close(stack.pop()!, block.source.startOffset);
      const parent = stack.at(-1)!;
      const section: SectionInfo = { id: `section-${sections.length}`, level: block.heading.level, title: block.heading.title,
        headingPath: [...parent.headingPath, block.heading.title], parentId: parent.id, childIds: [], blockIds: [], byteLength: 0, ...block.source };
      parent.childIds.push(section.id); sections.push(section); stack.push(section);
    }
    const section = stack.at(-1)!;
    section.blockIds.push(block.id);
    blocks.push({ id: block.id, kind: block.kind, sectionId: section.id, byteLength: byteLength(block.text), ...block.source });
  }
  while (stack.length > 1) close(stack.pop()!, source.length);
  const count = (kind: StructuralBlockKind) => blocks.filter(b => b.kind === kind).length;
  // 코드/프런트매터의 예제 링크는 관찰 수치에 포함하지 않는다. inline code도 제외한다.
  const prose = parsed.filter(b => b.kind !== 'code' && b.kind !== 'frontmatter').map(b => b.text).join('\n')
    .replace(/(`+)[\s\S]*?\1/g, '').replace(/\\[\[\]<>]/g, '');
  const destinations = [...prose.matchAll(/(?<!!)\[[^\]\n]+\]\(\s*(<?[^\s)>]+>?)(?:\s+[^)]*)?\)|<(https?:\/\/[^>\s]+|mailto:[^>\s]+)>/g)]
    .map(m => (m[1] ?? m[2]).replace(/^<|>$/g, ''));
  const externalLinkCount = destinations.filter(d => /^https?:\/\//i.test(d)).length;
  const footnoteReferenceCount = [...prose.matchAll(/\[\^[^\]\s]+\](?!:)/g)].length;
  const frontmatter = parsed.find(b => b.kind === 'frontmatter')?.text ?? '';
  const sourceMetadataKeys = [...new Set([...frontmatter.matchAll(/^(?:([A-Za-z][\w-]*)|["']([A-Za-z][\w-]*)["']):/gm)]
    .map(m => m[1] ?? m[2]).filter(key => /^(source|sources|url|doi|author|reference|references)$/i.test(key)))].sort();
  const stats: StructuralStats = { headingCount: count('heading'), sectionCount: sections.length, paragraphCount: count('paragraph'), listCount: count('list'),
    blockquoteCount: count('blockquote'), codeBlockCount: count('code'), tableCount: count('table'), linkCount: destinations.length, externalLinkCount };
  return { structure: { sections, blocks, stats }, groundingSignals: { externalLinkCount, footnoteReferenceCount,
    blockquoteCount: stats.blockquoteCount, tableCount: stats.tableCount, sourceMetadataKeys,
    referenceSectionCount: sections.filter(s => /^(references?|bibliography|sources?|참고\s*문헌|참고\s*자료|출처)$/i.test(s.title ?? '')).length } };
}
export class StructuralEngine {
  async generate(source: Source): Promise<StructuralFrame> {
    // 호출자가 편집 상태 객체를 바꾸더라도 이 실행은 하나의 원문 snapshot에 연결된다.
    source = { ...source };
    if (!source.text.trim()) throw new Error('처리할 내용이 없습니다.');
    const bytes = byteLength(source.text);
    if (bytes > MAX_LOCAL_BYTES) throw new Error('처리 한도(2 MiB)를 초과했습니다.');
    const parsed = parseMarkdownStructure(source.text);
    return { schemaVersion: STRUCTURAL_SCHEMA_VERSION, engine: 'local-structural-v1', generatedAt: new Date().toISOString(),
      sourceHash: await sourceHash(source.text), hashEncoding: 'sha256-utf8-raw-v1', parserVersion: SEGMENTER_VERSION, structureVersion: STRUCTURE_VERSION,
      document: { path: source.path, title: parsed.structure.sections.find(s => s.level === 1)?.title || source.basename,
        createdAt: source.ctime, modifiedAt: source.mtime, bytes, lineCount: source.text.split(/\r\n|\r|\n/).length },
      ...parsed, semantic: { status: 'not-run' } };
  }
}
