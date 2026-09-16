/** 기존 동작을 확인하는 자동 테스트. 각 사례 위 주석은 보장하려는 조건을 설명한다. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ManualQueue, StructuralEngine, MAX_BYTES } from '../src/core';
// 수동 요청이 없으면 실행하지 않고, 요청 후 정확히 60초 경계에서 한 번만 실행되는지 확인한다.
test('stability alone never runs; manual request respects exact 60-second boundary', () => {
  const q = new ManualQueue(); q.observe('a.md', 'a', 0, 0);
  assert.deepEqual(q.takeReady(100_000), []);
  q.request('a.md'); assert.deepEqual(q.takeReady(59_999), []);
  assert.deepEqual(q.takeReady(60_000), ['a.md']);
  q.request('a.md'); assert.deepEqual(q.takeReady(100_000), []);
  q.finish('a.md'); assert.deepEqual(q.takeReady(100_000), []);
});
// 내용 변경만 대기를 연장하고 동일 내용 저장이나 다른 문서는 영향을 주지 않는지 확인한다.
test('edits restart waiting, identical saves do not; documents are independent', () => {
  const q = new ManualQueue();
  for (const path of ['a.md', 'b.md']) { q.observe(path, 'a', 0, 0); q.request(path); }
  q.observe('a.md', 'changed', 30_000, 30_000);
  q.observe('b.md', 'a', 40_000, 40_000);
  assert.deepEqual(q.takeReady(60_000), ['b.md']);
  assert.deepEqual(q.takeReady(89_999), []);
  assert.deepEqual(q.takeReady(90_000), ['a.md']);
});
// 이미 안정된 문서는 즉시 처리하고 중복 요청 병합·문서 제거 시 취소가 되는지 확인한다.
test('old documents run immediately, duplicate requests merge, removal cancels', () => {
  const q = new ManualQueue(); q.observe('a', 'a', 0, 90_000);
  q.request('a'); q.request('a'); assert.deepEqual(q.takeReady(90_000), ['a']);
  q.finish('a'); q.request('a'); q.remove('a'); assert.deepEqual(q.takeReady(200_000), []);
});
// 원문을 보존하면서 코드 블록 밖 제목과 메타데이터, 비AI 표시를 만드는지 확인한다.
test('structural Frame retains source and marks semantics not run', async () => {
  const source = { path: 'folder/test.md', basename: 'test', ctime: 0, mtime: 1, text: '# 제목\r\n\r\n```md\r\n# ignore\r\n```\r\n## 소제목\r\n한글' };
  const original = structuredClone(source);
  const frame = await new StructuralEngine().generate(source);
  assert.deepEqual(source, original);
  assert.equal(frame.document.title, '제목');
  assert.equal(frame.document.bytes, Buffer.byteLength(source.text));
  assert.deepEqual(frame.structure.sections.filter(s => s.level > 0).map(s => s.startLine), [1, 6]);
  assert.equal(frame.structure.sections[0].endLine, 7);
  assert.equal(frame.engine, 'local-structural-v1');
  assert.deepEqual(frame.semantic, { status: 'not-run' });
  for (const key of ['domains', 'contentNature', 'concepts', 'knowledgeUnits', 'confidence']) { assert.ok(!(key in frame)); assert.ok(!(key in frame.document)); }
  assert.deepEqual(JSON.parse(JSON.stringify(frame)), frame);
});
// 빈 내용과 로컬 용량 한도 초과 입력에서 결과 생성을 거부하는지 확인한다.
test('empty or oversized input does not produce a Frame', async () => {
  const engine = new StructuralEngine();
  for (const text of ['', ' \n\t', 'x'.repeat(MAX_BYTES + 1)]) await assert.rejects(engine.generate({ path: 'a.md', basename: 'a', ctime: 0, mtime: 0, text }));
});
