import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameStore, GeminiKey, decodeSaved, SECRET_ID } from '../src/storage';
import { TestEngine } from '../src/core';
const frame = new TestEngine().generate({ path: 'a.md', basename: 'a', text: '내용', ctime: 0, mtime: 0 });
test('legacy migration preserves Frames; settings and Frame writes serialize without loss', async () => {
  const writes: unknown[] = [];
  const store = new FrameStore(async value => { writes.push(structuredClone(value)); });
  store.load({ version: 1, frames: { 'a.md': frame } });
  await Promise.all([store.saveSettings(), store.saveFrame('b.md', frame), store.saveSettings()]);
  assert.deepEqual(Object.keys(store.state.frames), ['a.md', 'b.md']);
  assert.deepEqual(store.state.frames['a.md'], frame);
  assert.equal(store.state.version, 2);
  assert.deepEqual(decodeSaved(writes.at(-1)), store.state);
});
test('failed writes preserve previous state and later writes recover; unknown storage rejected', async () => {
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

test('previous model settings migrate while Frames and historical attempts remain unchanged', async () => {
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
