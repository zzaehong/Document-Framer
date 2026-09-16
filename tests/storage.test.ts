/** 기존 동작을 확인하는 자동 테스트. 각 사례 위 주석은 보장하려는 조건을 설명한다. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL, FrameStore, GeminiKey, decodeSaved, SECRET_ID } from '../src/storage';
import { StructuralEngine } from '../src/core';
const makeFrame = () => new StructuralEngine().generate({ path: 'a.md', basename: 'a', text: '내용', ctime: 0, mtime: 0 });
// 구버전 Frame을 보존하며 설정과 Frame의 동시 저장이 데이터 손실 없이 직렬화되는지 확인한다.
test('legacy migration preserves Frames; settings and Frame writes serialize without loss', async () => {
  const frame = await makeFrame();
  const writes: unknown[] = [];
  const store = new FrameStore(async value => { writes.push(structuredClone(value)); });
  store.load({ version: 1, frames: { 'a.md': frame } });
  await Promise.all([store.saveSettings(), store.saveFrame('b.md', frame), store.saveSettings()]);
  assert.deepEqual(Object.keys(store.state.frames), ['a.md', 'b.md']);
  assert.deepEqual(store.state.frames['a.md'], frame);
  assert.equal(store.state.version, 3);
  assert.deepEqual(decodeSaved(writes.at(-1)), store.state);
});
// 저장 실패 시 이전 상태를 보존하고 이후 저장은 복구하며 알 수 없는 저장 형식을 거부하는지 확인한다.
test('failed writes preserve previous state and later writes recover; unknown storage rejected', async () => {
  const frame = await makeFrame();
  let fail = true;
  const store = new FrameStore(async () => { if (fail) throw new Error('disk'); });
  store.load({ version: 1, frames: { 'a.md': frame } });
  const before = store.state;
  await assert.rejects(store.saveFrame('b.md', frame));
  assert.equal(store.state, before);
  fail = false; await store.saveSettings();
  assert.deepEqual(Object.keys(store.state.frames), ['a.md']);
  for (const value of [{ version: 9, frames: {} }, { version: 1, frames: [] }, { version: 2, frames: {} }]) assert.throws(() => decodeSaved(value));
});
// 키가 공식 비밀 저장소만 사용하고 삭제·입력 검사·오류 메시지에서도 비밀값이 보호되는지 확인한다.
test('keys use only the official secret store; clearing removes usable value, errors redact secrets', () => {
  const values = new Map<string, string>();
  const key = new GeminiKey({ getSecret: id => values.get(id) ?? null, setSecret: (id, value) => { values.set(id, value); } });
  key.save(' dummy-secret '); assert.equal(key.read(), 'dummy-secret');
  assert.equal(values.get(SECRET_ID), 'dummy-secret');
  key.clear(); assert.equal(key.read(), null);
  assert.throws(() => key.save('a b'));
  assert.throws(() => new GeminiKey(undefined).save('key'), /1.11.4/);
  assert.throws(() => new GeminiKey({ getSecret: () => { throw new Error('secret'); }, setSecret() {} }).read(), /비밀 저장소를 읽지/);
});

// 기본 모델 설정만 이전하고 기존 Frame과 과거 호출의 생성 조건은 유지하는지 확인한다.
test('previous model settings migrate while Frames and historical attempts remain unchanged', async () => {
  const frame = await makeFrame();
  const oldAttempt = { id: 'old:1', revision: 1, sessionId: 'old-session', runId: 'old', purpose: 'classification', transport: 'settled', requestedModel: 'gemini-2.5-flash-lite', modelVersion: 'gemini-2.5-flash-lite-001', trace: { generationConfig: { thinkingConfig: { thinkingBudget: 0 }, temperature: 0 } }, usage: { status: 'unknown', tokens: {} } };
  const previous = { version: 2, settings: { model: 'gemini-2.5-flash-lite', secretId: SECRET_ID }, frames: { 'a.md': frame }, attempts: [oldAttempt] };
  let saved: unknown;
  const store = new FrameStore(async data => { saved = structuredClone(data); });
  store.load(previous);
  assert.equal(store.state.settings.model, 'gemini-3.1-flash-lite');
  assert.deepEqual(store.state.frames['a.md'], frame);
  assert.deepEqual(store.state.attempts, [oldAttempt]);
  await store.saveSettings();
  assert.deepEqual(decodeSaved(saved), store.state);
  assert.equal(previous.settings.model, 'gemini-2.5-flash-lite');
});

// 외부/구버전 저장 결과를 발견해도 annotation을 잃는 강제 변환을 하지 않는다.
test('legacy schema 4 payload preserves human annotations across settings writes and reload', async () => {
  const legacy = { schemaVersion: 4, concepts: [{ id: 'c1', concept: '사용자 표현', confidence: 0.8, highlight: true, evidence: [{ blockIds: ['b1'], labels: [{ id: 'claim', confidence: 0.8 }] }] }], humanCorrection: { concept: '사용자 표현' } };
  let saved: unknown;
  const store = new FrameStore(async data => { saved = structuredClone(data); });
  store.load({ version: 3, settings: { model: MODEL, secretId: SECRET_ID }, frames: { 'old.md': legacy }, attempts: [], domains: [] });
  await store.saveSettings();
  const next = new FrameStore(async () => {}); next.load(saved);
  assert.deepEqual(next.state.frames['old.md'], legacy);
});

test('invalidated local result waiting behind another write is never sent to storage', async () => {
  const frame = await makeFrame();
  let release!: () => void, writes = 0, valid = true;
  const store = new FrameStore(async () => { writes++; await new Promise<void>(resolve => { release = resolve; }); });
  const first = store.saveSettings();
  await new Promise(resolve => setImmediate(resolve));
  const pending = store.saveFrame('a.md', frame, () => valid);
  valid = false; release(); await first;
  await assert.rejects(pending, /종료/); assert.equal(writes, 1);
  assert.equal(store.state.frames['a.md'], undefined);
});
