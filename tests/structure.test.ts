/** Phase 1 관찰과 Context packing의 계약. 모델 응답에 의존하지 않는다. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { StructuralEngine, parseMarkdownStructure } from '../src/structure';
import { buildContextUnits, ContextBudget, ContextUnit } from '../src/context';
import { byteLength } from '../src/budget';
import { sourceHash } from '../src/evaluation';
import { FrameStore } from '../src/storage';
const frameFor = (text: string) => new StructuralEngine().generate({ path: 'note.md', basename: 'note', ctime: 3, mtime: 4, text });
const budget = (maxBytes: number): ContextBudget => ({ maxBytes, maxBlocks: 64, maxUnits: 1000, minSectionBytes: 0 });
const contextsFor = async (text: string, maxBytes: number) => buildContextUnits(text, await frameFor(text), budget(maxBytes));
function coverage(source: string, units: ContextUnit[]) {
  let cursor = 0;
  for (const unit of units) {
    for (const range of unit.sourceRanges) {
      assert.equal(range.startOffset, cursor, '본문 누락/중복/역순 금지');
      assert.ok(range.endOffset > cursor);
      assert.ok(!/[\uD800-\uDBFF]$/.test(source.slice(range.startOffset, range.endOffset)));
      assert.ok(!/^[\uDC00-\uDFFF]/.test(source.slice(range.startOffset, range.endOffset)));
      assert.ok(!(source[range.endOffset - 1] === '\r' && source[range.endOffset] === '\n'));
      cursor = range.endOffset;
    }
    const original = unit.sourceRanges.map(r => source.slice(r.startOffset, r.endOffset)).join('');
    assert.equal(unit.renderedMarkdown, (unit.headingWrapper ? unit.headingWrapper + '\n\n' : '') + original);
    assert.equal(unit.byteLength, byteLength(unit.renderedMarkdown));
  }
  assert.equal(cursor, source.length);
}

test('heading hierarchy uses subtree ranges, unique direct membership and deterministic paths', () => {
  const source = '# A\n\nintro\n\n## B\n\n### C\n\nC body\n\n## D\n\nD body';
  const parsed = parseMarkdownStructure(source);
  const [root, a, b, c, d] = parsed.structure.sections;
  assert.deepEqual(parsed, parseMarkdownStructure(source));
  assert.deepEqual(a.childIds, [b.id, d.id]); assert.deepEqual(b.childIds, [c.id]);
  assert.deepEqual(c.headingPath, ['A', 'B', 'C']); assert.deepEqual(d.headingPath, ['A', 'D']);
  assert.equal(b.endOffset, d.startOffset); assert.equal(c.endOffset, d.startOffset);
  assert.equal(a.endOffset, source.length); assert.equal(root.startOffset, 0);
  assert.equal(b.byteLength, byteLength(source.slice(b.startOffset, b.endOffset)));
  const memberships = parsed.structure.sections.flatMap(s => s.blockIds);
  assert.equal(memberships.length, parsed.structure.blocks.length);
  assert.equal(new Set(memberships).size, memberships.length);
  assert.equal(parsed.structure.blocks.find(x => source.slice(x.startOffset, x.endOffset).includes('C body'))!.sectionId, c.id);
});

test('skipped levels, empty ATX titles, closing hashes and Setext headings retain hierarchy', () => {
  const source = '# A\n\n#### D\n\n## B ##\n\nSetext\n======\n\n###\n';
  const sections = parseMarkdownStructure(source).structure.sections;
  assert.deepEqual(sections.map(s => s.headingPath), [[], ['A'], ['A', 'D'], ['A', 'B'], ['Setext'], ['Setext', '']]);
});

test('fenced/indented code and quote/list markers cannot introduce fake sections', () => {
  const source = '# Real\n\n````md\n# Fake\n- fake\n| fake |\n```\n````\n\n    # Indented fake\n\n> # Quoted fake\n> quote\n\n- item\n  # nested fake\n  - child\n';
  const parsed = parseMarkdownStructure(source);
  assert.deepEqual(parsed.structure.sections.map(s => s.title), [null, 'Real']);
  assert.deepEqual(parsed.structure.blocks.map(b => b.kind), ['heading', 'code', 'code', 'blockquote', 'list']);
});

test('paragraph/list/quote/table/frontmatter/rule are separate blocks with unchanged CRLF offsets', () => {
  const source = '\uFEFF---\r\nsource: book\r\n---\r\n\r\n# 제목 😀\r\n\r\n문단\r\n둘째 줄\r\n\r\n1. 부모\r\n   - 자식\r\n\r\n2. 다음\r\n\r\n> 인용\r\n> 계속\r\n\r\n| A | B |\r\n| --- | ---: |\r\n| 1 | 2 |\r\n\r\n---\r\n\r\n마지막';
  const parsed = parseMarkdownStructure(source);
  assert.deepEqual(parsed.structure.blocks.map(b => b.kind), ['frontmatter', 'heading', 'paragraph', 'list', 'blockquote', 'table', 'horizontal-rule', 'paragraph']);
  for (const block of parsed.structure.blocks) {
    assert.equal(byteLength(source.slice(block.startOffset, block.endOffset)), block.byteLength);
    assert.equal(source.slice(0, block.startOffset).split(/\r\n|\n|\r/).length, block.startLine);
    assert.ok(!('text' in block));
  }
});

test('grounding is observed syntax, excludes code, and never produces semantic fields', async () => {
  const source = '---\nsource: book\nurl: https://metadata.invalid\ntags: [test]\n---\n\n# References\n\n[external](https://example.invalid) [local](note.md) <https://other.invalid> [^1]\n\n[^1]: footnote\n\n> quote\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```md\n# Fake reference\n[x](https://fake.invalid) [^fake]\n```\n\n`[inline](https://fake.invalid)`';
  const frame = await frameFor(source);
  assert.deepEqual(frame.groundingSignals, { externalLinkCount: 2, footnoteReferenceCount: 1, blockquoteCount: 1, tableCount: 1, sourceMetadataKeys: ['source', 'url'], referenceSectionCount: 1 });
  assert.equal(frame.structure.stats.linkCount, 3);
  assert.equal(frame.semantic.status, 'not-run');
  for (const key of ['domains', 'contentNature', 'concepts', 'knowledgeUnits', 'confidence']) {
    assert.ok(!(key in frame)); assert.ok(!(key in frame.document));
  }
  const saved = JSON.stringify(frame);
  assert.ok(!saved.includes('https://example.invalid')); assert.ok(!saved.includes('local-test-v1')); assert.ok(!saved.includes('TEST_ONLY'));
});

test('full section fits as one context without paragraph-by-paragraph requests', async () => {
  const source = '# CAPM\n\nCAPM은 이론이다.\n\n베타는 지표다.\n\n## 하위\n\n따라서 설명한다.\n';
  const units = await contextsFor(source, 512);
  assert.equal(units.length, 1); assert.equal(units[0].renderedMarkdown, source);
  coverage(source, units);
});

test('large parent splits at child sections and restores every ancestor heading', async () => {
  const source = '# 투자 이론\n\n## 효율성\n\n### 약형\n\n' + '약형 설명. '.repeat(8) + '\n\n### 강형\n\n' + '강형 설명. '.repeat(8);
  const units = await contextsFor(source, 230);
  const weak = units.find(u => u.headingPath.at(-1) === '약형')!;
  const strong = units.find(u => u.headingPath.at(-1) === '강형')!;
  assert.ok(weak); assert.ok(strong);
  assert.ok(weak.renderedMarkdown.startsWith('# 투자 이론\n## 효율성\n\n### 약형'));
  assert.deepEqual(strong.headingPath, ['투자 이론', '효율성', '강형']);
  assert.ok(units.every(u => u.byteLength <= 230)); coverage(source, units);
});

test('list with nested items remains atomic when it fits', async () => {
  const list = '1. 위험 감소\n   - 하위 설명\n2. 의존도 감소\n3. 변동성 감소\n';
  const source = '서론. '.repeat(20) + '\n\n' + list + '\n마무리. '.repeat(20);
  const frame = await frameFor(source), units = await buildContextUnits(source, frame, budget(180));
  const block = frame.structure.blocks.find(b => b.kind === 'list')!;
  assert.equal(units.filter(u => u.blockIds.includes(block.id)).length, 1);
  coverage(source, units);
});

test('large list splits at top-level items, keeping nested children with each parent', async () => {
  const items = Array.from({ length: 8 }, (_, i) => `${i + 1}. parent ${i}\n   - child ${i}\n   - detail ${i}\n`);
  const source = items.join('');
  const units = await contextsFor(source, 90);
  assert.ok(units.length > 1);
  for (const item of items) assert.equal(units.filter(u => u.renderedMarkdown.includes(item)).length, 1);
  coverage(source, units);
});

test('table and fenced code stay atomic within budget; oversized atoms fail explicitly', async () => {
  const table = '| A | B |\n| --- | --- |\n| 1 | 2 |\n';
  const code = '```ts\nconst value = 1;\n```\n';
  const source = '# A\n\n' + 'intro '.repeat(10) + '\n\n' + table + '\n' + code;
  const frame = await frameFor(source), units = await buildContextUnits(source, frame, budget(110));
  for (const b of frame.structure.blocks.filter(b => ['table', 'code'].includes(b.kind))) assert.equal(units.filter(u => u.blockIds.includes(b.id)).length, 1);
  coverage(source, units);
  for (const oversized of ['```\n' + 'x'.repeat(300) + '\n```', '| A | B |\n| --- | --- |\n' + '| x | y |\n'.repeat(50), '---\nsource: ' + 'x'.repeat(300) + '\n---']) {
    const saved = await frameFor(oversized); // 로컬 구조 저장은 모델 예산과 독립이다.
    await assert.rejects(buildContextUnits(oversized, saved, budget(100)), /블록/);
  }
});

test('headingless prose uses root, preserves paragraphs and source coverage', async () => {
  const paragraphs = Array.from({ length: 20 }, (_, i) => `문단 ${i}. 설명문이다.`);
  const source = paragraphs.join('\n\n');
  const frame = await frameFor(source), units = await buildContextUnits(source, frame, budget(100));
  assert.equal(frame.structure.sections.length, 1); assert.equal(frame.structure.sections[0].id, 'section-root');
  assert.ok(units.length > 1); assert.ok(units.every(u => !u.headingWrapper));
  for (const paragraph of paragraphs) assert.equal(units.filter(u => u.renderedMarkdown.includes(paragraph)).length, 1);
  coverage(source, units);
});

test('oversized paragraphs prefer sentences then lines and finally Unicode-safe hard boundaries', async () => {
  for (const source of ['문장이다. '.repeat(100), '문장줄\r\n'.repeat(100), '한글😀'.repeat(150)]) {
    const frame = await frameFor(source);
    const units = await buildContextUnits(source, frame, budget(65));
    assert.deepEqual(await buildContextUnits(source, frame, budget(65)), units);
    assert.ok(units.every(u => u.byteLength <= 65)); coverage(source, units);
    if (source.startsWith('문장이다')) assert.ok(units.slice(0, -1).every(u => u.renderedMarkdown.endsWith('.')));
    if (source.includes('\r\n')) assert.ok(units.slice(0, -1).every(u => u.renderedMarkdown.endsWith('\r\n')));
  }
});

test('small adjacent siblings merge repeatedly but distinct H1 topics never mix', async () => {
  const source = Array.from({ length: 12 }, (_, i) => `## ${i}\n\nsmall\n\n`).join('');
  const units = await buildContextUnits(source, await frameFor(source), { ...budget(110), minSectionBytes: 50 });
  assert.ok(units.length < 6); assert.ok(units.some(u => u.sectionIds.length >= 3)); coverage(source, units);
  const separate = '# A\n\nsmall\n\n# B\n\nsmall';
  assert.equal((await buildContextUnits(separate, await frameFor(separate), { ...budget(500), minSectionBytes: 500 })).length, 2);
});

test('all raw whitespace, CRLF, punctuation and Unicode are covered exactly once', async () => {
  const source = '\r\n# A😀\r\n\r\n' + '문장! '.repeat(20) + '\r\n\r\n## B\r\n\r\n> 인용\r\n> 끝\r\n\r\n- 목록\r\n- 끝\r\n\r\n';
  coverage(source, await contextsFor(source, 100));
});

test('source hash detects stale input and structural persistence survives restart without raw text', async () => {
  const source = '# 제목\n\nprivate body phrase';
  const frame = await frameFor(source);
  assert.equal(frame.sourceHash, await sourceHash(source));
  await assert.rejects(buildContextUnits(source + ' changed', frame), /버전/);
  let saved: unknown; const store = new FrameStore(async value => { saved = structuredClone(value); });
  await store.saveFrame('note.md', frame);
  const next = new FrameStore(async () => {}); next.load(saved);
  assert.deepEqual(next.state.frames['note.md'], frame);
  assert.ok(!JSON.stringify(saved).includes('private body phrase'));
  coverage(source, await buildContextUnits(source, frame));
});

test('legacy local frame is retained until explicit local replacement', async () => {
  const old = { schemaVersion: 1, engine: 'local-test-v1', knowledgeUnits: [{ labels: ['TEST_ONLY'] }] };
  const store = new FrameStore(async () => {});
  store.load({ version: 1, frames: { 'note.md': old, 'other.md': old } });
  await store.saveSettings(); assert.deepEqual(store.state.frames['note.md'], old);
  const frame = await frameFor('body'); await store.saveFrame('note.md', frame);
  assert.equal(store.state.frames['note.md'].engine, 'local-structural-v1');
  assert.deepEqual(store.state.frames['other.md'], old);
});

test('real repository PRD and long headingless prose build bounded contexts with complete coverage', async () => {
  const samples = [await readFile('Doc/PRD-Document-Framer.md', 'utf8'), Array.from({ length: 600 }, (_, i) => `Paragraph ${i}. ${'내용 '.repeat(15)}`).join('\n\n')];
  for (const text of samples) {
    const units = await buildContextUnits(text, await frameFor(text));
    assert.ok(units.length > 1 && units.length <= 32);
    assert.ok(units.every(u => u.byteLength <= 16384 && u.blockIds.length <= 64));
    coverage(text, units);
  }
});


test('opening horizontal rule without frontmatter closure does not hide later headings', () => {
  const parsed = parseMarkdownStructure('---\n\n# Visible\n\nBody');
  assert.equal(parsed.structure.blocks[0].kind, 'horizontal-rule');
  assert.deepEqual(parsed.structure.sections.map(s => s.title), [null, 'Visible']);
});
