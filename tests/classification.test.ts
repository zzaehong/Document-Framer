import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBlocks } from '../src/blocks';
import { Classification, validateClassification } from '../src/classification';
import { GeminiFramer, MAX_AI_BYTES, MAX_BLOCKS } from '../src/framing';
import { GeminiClient, HttpRequest } from '../src/gemini';
const valid = (ids = ['b1', 'b2']): Classification => ({
  domains: [{ id: 'ai', confidence: 0.8 }, { id: 'business', confidence: 0.4 }],
  type: { id: 'prose-with-decision', confidence: 0.9 },
  units: [{ blockIds: ids, labels: [{ id: 'observation', confidence: 0.7 }, { id: 'decision', confidence: 0.9 }] }],
});
test('blocks retain exact CRLF and Unicode offsets across headings, lists, quotes, tables and fences', () => {
  const text = '\uFEFF---\r\ntitle: 테스트\r\n---\r\n\r\n# 제목 😀\r\n\r\n- 하나\r\n  - 둘\r\n\r\n> 인용\r\n> 계속\r\n\r\n| A | B |\r\n| - | - |\r\n| 1 | 2 |\r\n\r\n````md\r\n# 코드\r\n\r\n```\r\n````\r\n\r\n마지막';
  const blocks = extractBlocks(text);
  assert.deepEqual(blocks.map(b => b.kind), ['frontmatter', 'heading', 'text', 'text', 'text', 'code', 'text']);
  assert.deepEqual(blocks.map(b => [b.source.startLine, b.source.endLine]), [[1, 3], [5, 5], [7, 8], [10, 11], [13, 15], [17, 21], [23, 23]]);
  for (const block of blocks) assert.equal(text.slice(block.source.startOffset, block.source.endOffset), block.text);
  assert.equal(blocks.at(-1)?.source.endOffset, text.length);
  assert.deepEqual(extractBlocks(text), blocks);
});
test('empty, malformed Markdown and unclosed fences retain readable content without truncation', () => {
  assert.deepEqual(extractBlocks(' \n\t\r\n'), []);
  for (const text of ['~~~\n# not heading\n\n끝', '---\nx: y\n끝', '문장\n## heading\n끝', '😀\r끝', '[link](url)', '    code\n    more']) {
    const blocks = extractBlocks(text);
    const covered = new Set(blocks.flatMap(b => Array.from({ length: b.source.endOffset - b.source.startOffset }, (_, i) => b.source.startOffset + i)));
    for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) assert.ok(covered.has(i));
    assert.equal(blocks.at(-1)?.source.endOffset, text.length);
  }
});
test('valid multi-domain, hierarchy IDs, multi-label and Other/unclassified accepted', () => {
  const blocks = extractBlocks('# 제목\n\n결정 내용');
  assert.deepEqual(validateClassification(valid(), blocks), valid());
  const other = valid(); other.domains = [{ id: 'other', confidence: 0.1 }];
  other.type = { id: 'unclassified', confidence: 0 };
  other.units[0].labels = [{ id: 'unclassified', confidence: 0 }];
  assert.deepEqual(validateClassification(other, blocks), other);
});
test('schema rejects unknown taxonomy, extra fields, confidence errors and missing/duplicate/reordered block coverage', () => {
  const blocks = extractBlocks('# 제목\n\n결정 내용');
  const mutations: ((v: any) => void)[] = [
    v => { v.domains[0].id = 'invented'; }, v => { v.type.id = 'summary'; }, v => { v.units[0].labels[0].id = 'new'; },
    v => { v.type.confidence = 1.1; }, v => { v.type.confidence = -0.1; }, v => { v.type.confidence = NaN; }, v => { v.type.confidence = '0.9'; },
    v => { v.units[0].labels = []; }, v => { v.domains = []; }, v => { v.domains.push(v.domains[0]); },
    v => { v.domains.push({ id: 'other', confidence: 1 }); }, v => { v.units[0].labels.push({ id: 'unclassified', confidence: 0 }); },
    v => { v.metadata = { path: 'injected' }; }, v => { v.units[0].source = { startLine: 999 }; },
    v => { v.units[0].blockIds = ['b1']; }, v => { v.units[0].blockIds = ['b2', 'b1']; }, v => { v.units[0].blockIds = ['b1', 'b1']; },
    v => { v.units[0].blockIds = ['b1', 'b99']; }, v => { v.units = []; }, v => { delete v.type; },
  ];
  for (const mutate of mutations) { const v = valid(); mutate(v); assert.throws(() => validateClassification(v, blocks), /검증 실패/); }
});
test('one document call constructs preview with local metadata and locations; only IDs/text sent', async () => {
  const requests: HttpRequest[] = [];
  const framer = new GeminiFramer(new GeminiClient(async request => {
    requests.push(request);
    return { status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(valid()) }] } }] }) };
  }));
  const source = { path: 'private/folder.md', basename: 'folder', ctime: 123, mtime: 456, text: '# 제목 😀\r\n\r\n결정 내용' };
  const before = structuredClone(source);
  const preview = await framer.generate(source, 'dummy-key');
  assert.equal(requests.length, 1); assert.deepEqual(source, before);
  assert.ok(!requests[0].body.includes(source.path));
  const sent = JSON.parse(JSON.parse(requests[0].body).contents[0].parts[0].text);
  assert.deepEqual(Object.keys(sent.blocks[0]), ['id', 'text']);
  assert.equal(preview.frame.document.createdAt, 123);
  assert.equal(preview.frame.document.title, '제목 😀');
  assert.deepEqual(preview.frame.document.domains[0].path, ['Engineering', 'Computer Science', 'Artificial Intelligence']);
  assert.equal(preview.frame.knowledgeUnits[0].source.endOffset, source.text.length);
  assert.equal(preview.frame.previewOnly, true);
  assert.equal(preview.frame.document.importance, null);
  assert.equal(preview.frame.knowledgeUnits[0].highlight, false);
});
test('empty/oversized/too many blocks fail before network; invalid classification never triggers repair call', async () => {
  let calls = 0;
  const framer = new GeminiFramer(new GeminiClient(async () => { calls++; return { status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }] }) }; }));
  for (const text of ['', 'x'.repeat(MAX_AI_BYTES + 1), '# h\n'.repeat(MAX_BLOCKS + 1)]) await assert.rejects(framer.generate({ path: 'a', basename: 'a', ctime: 0, mtime: 0, text }, 'key'));
  assert.equal(calls, 0);
  await assert.rejects(framer.generate({ path: 'a', basename: 'a', ctime: 0, mtime: 0, text: 'body' }, 'key'), /검증 실패/);
  assert.equal(calls, 1);
});
