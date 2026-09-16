/** 기존 동작을 확인하는 자동 테스트. 각 사례 위 주석은 보장하려는 조건을 설명한다. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AttemptJournal, Attempt, readUsage, attemptSummary } from '../src/attempts';
import { GeminiClient, HttpResponse } from '../src/gemini';
import { GeminiFramer } from '../src/framing';
import { sourceHash, GENERATION_CONFIG } from '../src/evaluation';

const source = { path: 'evaluation/a.md', basename: 'a', ctime: 1, mtime: 2, text: '비민감 원문 😀\r\n두 번째 줄' };
const usage = { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18, cachedContentTokenCount: 3, thoughtsTokenCount: 0 };
const value = { domains: [{ path: ['Other'], source: 'unclassified', confidence: 0.1 }], type: { id: 'idea-note', confidence: 0.5 }, concepts: [{ concept: 'Reusable concept', confidence: 0.7, evidence: [{ blockIds: ['b1'], labels: [{ id: 'idea', confidence: 0.5 }] }] }] };
const response = (classification: unknown = value): HttpResponse => ({ status: 200, text: JSON.stringify({ usageMetadata: usage, modelVersion: 'gemini-3.1-flash-lite-001', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(classification) }] } }] }) });
const generate = (client: GeminiClient) => client.generate('dummy-secret', 'system', {}, {});
const tick = () => new Promise(resolve => setImmediate(resolve));

// 연결 검사·분류·재시도별 기록을 구분하고 해시·버전·생성 설정이 기록되는지 확인한다.
test('retries, connection and classification have independent attempt records and complete local provenance', async () => {
  let saved: Attempt[] = [];
  let calls = 0;
  const journal = new AttemptJournal(async attempts => { saved = structuredClone(attempts); });
  const client = new GeminiClient(async () => ++calls === 1 ? { status: 503, text: '{}' } : response(), async () => {}, 1000, journal);
  const framer = new GeminiFramer(client);
  const preview = await framer.generate(source, 'dummy-secret');
  const [first, second] = saved;
  assert.equal(saved.length, 2);
  assert.equal(first.runId, second.runId);
  assert.deepEqual(saved.map(a => a.attemptNumber), [1, 2]);
  assert.equal(first.usage.status, 'unknown'); assert.equal(first.usage.tokens.totalTokenCount, null);
  assert.equal(second.usage.status, 'confirmed'); assert.deepEqual(second.usage.tokens, { ...usage, toolUsePromptTokenCount: null });
  assert.equal(second.trace?.sourceHash, createHash('sha256').update(source.text, 'utf8').digest('hex'));
  assert.equal(second.trace?.runId, preview.frame.evaluation.runId);
  assert.equal(preview.frame.modelVersion, 'gemini-3.1-flash-lite-001');
  assert.equal(second.trace?.promptVersion, 'concept-extraction-v1');
  assert.equal(second.trace?.taxonomyVersion, 'domain-policy-v1/type-label-draft-0.1');
  assert.equal(second.trace?.segmenterVersion, 'markdown-blocks-v1');
  assert.deepEqual(second.trace?.generationConfig, GENERATION_CONFIG);
  assert.ok(second.durationMs !== null && second.durationMs >= 0);
  await framer.checkConnection('dummy-secret');
  assert.equal(saved.length, 3);
  assert.equal(saved[2].purpose, 'connection'); assert.equal(saved[2].trace?.documentPath, null);
  assert.notEqual(saved[2].runId, first.runId);
  assert.ok(!JSON.stringify(saved).includes('dummy-secret'));
  assert.ok(!JSON.stringify(saved).includes(source.text));
  assert.notEqual(await sourceHash(source.text), await sourceHash(source.text.replace('\r\n', '\n')));
});

// 분류 실패나 차단 응답에서도 사용량을 보존하고 누락 수치는 미확인으로 남기는지 확인한다.
test('usage survives schema failure, blocked output and network retry; absent fields stay unknown', async () => {
  const journal = new AttemptJournal(async () => {});
  let client = new GeminiClient(async () => response({}), undefined, 1000, journal);
  await assert.rejects(new GeminiFramer(client).generate(source, 'key'), /검증 실패/);
  assert.equal(journal.attempts[0].usage.tokens.totalTokenCount, 18);
  client = new GeminiClient(async () => ({ status: 200, text: JSON.stringify({ usageMetadata: usage, promptFeedback: { blockReason: 'SAFETY' } }) }), undefined, 1000, journal);
  await assert.rejects(generate(client), /JSON/);
  assert.equal(journal.attempts[1].outcome, 'invalid-response');
  assert.equal(journal.attempts[1].usage.status, 'confirmed');
  let calls = 0;
  client = new GeminiClient(async () => { if (++calls === 1) throw new Error('dummy-secret'); return response(); }, async () => {}, 1000, journal);
  await generate(client);
  assert.equal(journal.attempts[2].outcome, 'network-error');
  assert.equal(journal.attempts[2].usage.tokens.totalTokenCount, null);
  assert.equal(journal.attempts[3].usage.tokens.totalTokenCount, 18);
  const partial = readUsage({ promptTokenCount: 9, candidatesTokenCount: -1, totalTokenCount: '9', thoughtsTokenCount: 1.5 });
  assert.equal(partial.status, 'unknown'); assert.equal(partial.tokens.promptTokenCount, 9);
  assert.equal(partial.tokens.candidatesTokenCount, null); assert.equal(partial.tokens.totalTokenCount, null);
  assert.equal(readUsage(null).tokens.totalTokenCount, null);
  assert.match(attemptSummary(journal.attempts[2]), /미확인/);
});

// 시간 초과 후 늦은 응답이 같은 기록을 갱신하고 HTTP 종료 후 잠금이 풀리는지 확인한다.
test('timeout retains lock; late response updates exactly one attempt and restores local availability', async () => {
  let saved: Attempt[] = [];
  const journal = new AttemptJournal(async attempts => { saved = structuredClone(attempts); });
  let finish!: (value: HttpResponse) => void;
  let calls = 0;
  const client = new GeminiClient(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, async () => {}, 15, journal);
  const pending = generate(client);
  await assert.rejects(pending, /시간/);
  await journal.flush();
  assert.equal(client.status, 'timeout-pending'); assert.equal(saved.length, 1);
  assert.equal(saved[0].transport, 'pending'); assert.equal(saved[0].usage.status, 'unknown');
  await assert.rejects(generate(client), /진행 중/); assert.equal(calls, 1);
  const stale = structuredClone(saved[0]);
  finish(response()); await tick(); await journal.flush();
  assert.equal(client.status, 'idle'); assert.equal(saved.length, 1);
  assert.equal(saved[0].transport, 'settled'); assert.equal(saved[0].usage.tokens.totalTokenCount, 18);
  assert.ok(saved[0].timedOutAt !== null);
  await journal.record(stale); await journal.record(saved[0]);
  assert.equal(saved.length, 1); assert.equal(saved[0].usage.tokens.totalTokenCount, 18);
});

// 재시작 시 미해결 요청을 보존하고 사용자 확인을 요구하되 자동 재전송하지 않는지 확인한다.
test('restart retains unresolved attempts and requires acknowledgement without replay or permanent block', async () => {
  let saved: Attempt[] = [];
  const old = new AttemptJournal(async attempts => { saved = structuredClone(attempts); });
  let finish!: (value: HttpResponse) => void;
  const client = new GeminiClient(() => new Promise(resolve => { finish = resolve; }), undefined, 15, old);
  await assert.rejects(generate(client), /시간/); await old.flush();
  old.close(); client.close();
  const next = new AttemptJournal(async attempts => { saved = structuredClone(attempts); }); next.load(saved);
  assert.equal(next.needsAcknowledgement, true);
  await next.acknowledgeUnresolved();
  assert.equal(next.needsAcknowledgement, false);
  assert.equal(next.unresolved.length, 1); assert.equal(saved[0].transport, 'pending');
  const afterAck = structuredClone(saved);
  finish(response()); await tick();
  assert.deepEqual(saved, afterAck, 'unloaded session must not overwrite new-session data');
  const third = new AttemptJournal(async () => {}); third.load(saved);
  assert.equal(third.needsAcknowledgement, true, 'new session asks again while remote completion is unknown');
});

// 호출 기록 저장 실패는 전송을 막고 복구 확인 저장 실패도 차단을 해제하지 않는지 확인한다.
test('record persistence failure prevents HTTP and acknowledgement failure does not unlock recovery', async () => {
  const journal = new AttemptJournal(async () => { throw new Error('disk'); });
  let calls = 0;
  const client = new GeminiClient(async () => { calls++; return response(); }, undefined, 1000, journal);
  await assert.rejects(generate(client), /기록/);
  assert.equal(calls, 0); assert.equal(journal.attempts[0].transport, 'not-sent');
  assert.equal(journal.persistenceError, true);
  const unresolved = { ...journal.attempts[0], sessionId: 'previous-session', transport: 'pending' as const };
  journal.load([unresolved]);
  await assert.rejects(journal.acknowledgeUnresolved(), /기록/);
  assert.equal(journal.needsAcknowledgement, true);
});

// 전송 도중 요청이 무효화되면 재시도하지 않으면서 수신 사용량은 남기는지 확인한다.
test('invalidation during HTTP suppresses retry while preserving returned usage', async () => {
  const journal = new AttemptJournal(async () => {});
  let valid = true;
  let calls = 0;
  const client = new GeminiClient(async () => {
    calls++; valid = false;
    return { status: 503, text: JSON.stringify({ usageMetadata: usage }) };
  }, async () => {}, 1000, journal);
  await assert.rejects(client.generate('key', 'system', {}, {}, undefined, () => valid), /종료/);
  assert.equal(calls, 1); assert.equal(journal.attempts.length, 1);
  assert.equal(journal.attempts[0].usage.tokens.totalTokenCount, 18);
});

// 호출 기록·Frame·설정의 저장이 겹쳐도 각 데이터를 보존하는지 확인한다.
test('journal writes serialize with Frame/settings persistence without replacing either data set', async () => {
  const { FrameStore } = await import('../src/storage');
  const { TestEngine } = await import('../src/core');
  const store = new FrameStore(async () => {});
  const frame = new TestEngine().generate(source);
  store.load({ version: 1, frames: { 'original.md': frame } });
  const journal = new AttemptJournal(attempts => store.saveAttempts(attempts));
  const client = new GeminiClient(async () => response(), undefined, 1000, journal);
  await Promise.all([generate(client), store.saveFrame('second.md', frame), store.saveSettings()]);
  await journal.flush();
  assert.deepEqual(Object.keys(store.state.frames), ['original.md', 'second.md']);
  assert.equal(store.state.attempts.length, 1);
  assert.equal(store.state.attempts[0].usage.tokens.totalTokenCount, 18);
  const next = new FrameStore(async () => {}); next.load(structuredClone(store.state));
  assert.equal(next.state.attempts[0].id, store.state.attempts[0].id);
});
