import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ManualQueue, TestEngine, MAX_BYTES } from '../src/core';
test('stability alone never runs; manual request respects exact 60-second boundary', () => {
  const q = new ManualQueue(); q.observe('a.md', 'a', 0, 0);
  assert.deepEqual(q.takeReady(100_000), []);
  q.request('a.md'); assert.deepEqual(q.takeReady(59_999), []);
  assert.deepEqual(q.takeReady(60_000), ['a.md']);
  q.request('a.md'); assert.deepEqual(q.takeReady(100_000), []);
  q.finish('a.md'); assert.deepEqual(q.takeReady(100_000), []);
});
test('edits restart waiting, identical saves do not; documents are independent', () => {
  const q = new ManualQueue();
  for (const path of ['a.md', 'b.md']) { q.observe(path, 'a', 0, 0); q.request(path); }
  q.observe('a.md', 'changed', 30_000, 30_000);
  q.observe('b.md', 'a', 40_000, 40_000);
  assert.deepEqual(q.takeReady(60_000), ['b.md']);
  assert.deepEqual(q.takeReady(89_999), []);
  assert.deepEqual(q.takeReady(90_000), ['a.md']);
});
test('old documents run immediately, duplicate requests merge, removal cancels', () => {
  const q = new ManualQueue(); q.observe('a', 'a', 0, 90_000);
  q.request('a'); q.request('a'); assert.deepEqual(q.takeReady(90_000), ['a']);
  q.finish('a'); q.request('a'); q.remove('a'); assert.deepEqual(q.takeReady(200_000), []);
});
test('test Frame retains source, includes metadata and explicit non-AI annotations', () => {
  const source = { path: 'folder/test.md', basename: 'test', ctime: 0, mtime: 1, text: '# 제목\r\n\r\n```md\r\n# ignore\r\n```\r\n## 소제목\r\n한글' };
  const original = structuredClone(source);
  const frame = new TestEngine().generate(source);
  assert.deepEqual(source, original);
  assert.equal(frame.document.title, '제목');
  assert.equal(frame.document.bytes, Buffer.byteLength(source.text));
  assert.deepEqual(frame.document.headings.map(h => h.line), [1, 6]);
  assert.equal(frame.knowledgeUnits[0].source.endLine, 7);
  assert.equal(frame.engine, 'local-test-v1');
  assert.equal(frame.document.confidence, null);
  assert.deepEqual(JSON.parse(JSON.stringify(frame)), frame);
});
test('empty or oversized input does not produce a Frame', () => {
  const engine = new TestEngine();
  for (const text of ['', ' \n\t', 'x'.repeat(MAX_BYTES + 1)]) assert.throws(() => engine.generate({ path: 'a.md', basename: 'a', ctime: 0, mtime: 0, text }));
});
