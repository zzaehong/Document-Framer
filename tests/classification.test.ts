/** 기존 동작을 확인하는 자동 테스트. 각 사례 위 주석은 보장하려는 조건을 설명한다. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBlocks } from '../src/blocks';
import { validateExtraction } from '../src/concepts';
import { BUDGET } from '../src/budget';
import { GeminiFramer } from '../src/framing';
import { GeminiClient, HttpRequest } from '../src/gemini';
const valid = () => ({
  domains: [{ path: ['Engineering', 'Computer Science', 'Artificial Intelligence'], source: 'new', confidence: 0.8 }, { path: ['Business'], source: 'new', confidence: 0.4 }],
  contentNature: { id: 'opinion', confidence: 0.9 },
  concepts: [{ concept: 'Architectural Decision', confidence: 0.8 }],
});
// 여러 Markdown 요소와 한글·이모지·CRLF에서도 블록의 원문 범위가 정확한지 확인한다.
test('blocks retain exact CRLF and Unicode offsets across headings, lists, quotes, tables and fences', () => {
  const text = '\uFEFF---\r\ntitle: 테스트\r\n---\r\n\r\n# 제목 😀\r\n\r\n- 하나\r\n  - 둘\r\n\r\n> 인용\r\n> 계속\r\n\r\n| A | B |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\n````md\r\n# 코드\r\n\r\n```\r\n````\r\n\r\n마지막';
  const blocks = extractBlocks(text);
  assert.deepEqual(blocks.map(b => b.kind), ['frontmatter', 'heading', 'list', 'blockquote', 'table', 'code', 'paragraph']);
  assert.deepEqual(blocks.map(b => [b.source.startLine, b.source.endLine]), [[1, 3], [5, 5], [7, 8], [10, 11], [13, 15], [17, 21], [23, 23]]);
  for (const block of blocks) assert.equal(text.slice(block.source.startOffset, block.source.endOffset), block.text);
  assert.equal(blocks.at(-1)?.source.endOffset, text.length);
  assert.deepEqual(extractBlocks(text), blocks);
});
// 빈 문서와 닫히지 않은 코드 울타리 등에서도 읽을 수 있는 원문이 잘리지 않는지 확인한다.
test('empty, malformed Markdown and unclosed fences retain readable content without truncation', () => {
  assert.deepEqual(extractBlocks(' \n\t\r\n'), []);
  for (const text of ['~~~\n# not heading\n\n끝', '---\nx: y\n끝', '문장\n## heading\n끝', '😀\r끝', '[link](url)', '    code\n    more']) {
    const blocks = extractBlocks(text);
    const covered = new Set(blocks.flatMap(b => Array.from({ length: b.source.endOffset - b.source.startOffset }, (_, i) => b.source.startOffset + i)));
    for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) assert.ok(covered.has(i));
    assert.equal(blocks.at(-1)?.source.endOffset, text.length);
  }
});
// 폐기한 Type 및 생성 요약 등 추가 필드를 새 분류 계약이 받아들이지 않는지 확인한다.
test('extraction rejects invalid nature, confidence and unexpected generated fields', () => {
  const mutations: ((v: any) => void)[] = [
    v => { v.contentNature.id = 'informational'; }, v => { v.contentNature.confidence = NaN; },
    v => { v.concepts[0].summary = 'AI summary'; }, v => { v.type = v.contentNature; },
    v => { delete v.contentNature; },
  ];
  for (const mutate of mutations) { const value = valid(); mutate(value); assert.throws(() => validateExtraction(value, [], 'chunk-1'), /검증 실패/); }
});

test('short document uses one extraction call and constructs minimal concept metadata', async () => {
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
  assert.equal(sent.contextMarkdown, source.text);
  assert.deepEqual(sent.frontmatterRanges, []);
  assert.equal(preview.frame.document.createdAt, 123);
  assert.equal(preview.frame.document.title, '제목 😀');
  assert.deepEqual(Object.keys(preview.frame.concepts[0]), ['id', 'concept', 'confidence', 'highlight']);
  assert.equal(preview.frame.previewOnly, true);
  assert.equal(preview.frame.document.importance, null);
  assert.equal(preview.frame.concepts[0].highlight, false);
  assert.equal(preview.frame.schemaVersion, 5);
  assert.ok(!('knowledgeUnits' in preview.frame));
});

test('empty and over-budget documents fail before network; malformed extraction never gets repair call', async () => {
  let calls = 0;
  const framer = new GeminiFramer(new GeminiClient(async () => { calls++; return { status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }] }) }; }));
  for (const text of ['', '```\n' + 'x'.repeat(BUDGET.maxChunkBytes + 1) + '\n```', 'x'.repeat(BUDGET.maxDocumentBytes + 1), '# h\n'.repeat(BUDGET.maxBlocksPerChunk * BUDGET.maxChunks + 1)]) await assert.rejects(framer.generate({ path: 'a', basename: 'a', ctime: 0, mtime: 0, text }, 'key'));
  assert.equal(calls, 0);
  await assert.rejects(framer.generate({ path: 'a', basename: 'a', ctime: 0, mtime: 0, text: 'body' }, 'key'), /검증 실패/);
  assert.equal(calls, 1);
});

test('Gemini receives Markdown context with frontmatter ranges but no grounding classification signals', async () => {
  const text = '---\nsource: book\n---\n\n일반 본문이다.';
  const preview = await new GeminiFramer(new GeminiClient(async request => {
    const input = JSON.parse(JSON.parse(request.body).contents[0].parts[0].text);
    assert.deepEqual(Object.keys(input), ['existingDomains', 'contextMarkdown', 'frontmatterRanges']);
    assert.equal(input.contextMarkdown, text);
    assert.equal(input.frontmatterRanges.length, 1);
    const range = input.frontmatterRanges[0];
    assert.equal(input.contextMarkdown.slice(range.startOffset, range.endOffset), '---\nsource: book\n---\n');
    return { status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(valid()) }] } }] }) };
  })).generate({ path: 'a.md', basename: 'a', ctime: 0, mtime: 0, text }, 'key');
  assert.equal(preview.frame.schemaVersion, 5);
});
