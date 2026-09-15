/** 기존 동작을 확인하는 자동 테스트. 각 사례 위 주석은 보장하려는 조건을 설명한다. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiClient, HttpRequest, HttpResponse } from '../src/gemini';
const response = (value: unknown): HttpResponse => ({ status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }) });
const generate = (client: GeminiClient) => client.generate('dummy-secret', 'system', { blocks: [] }, { type: 'object' });
// 고정 모델과 JSON 스키마를 사용하고 키가 헤더에만 포함되어 한 번 호출되는지 확인한다.
test('one call by default, fixed model, key only in header and JSON schema requested', async () => {
  const requests: HttpRequest[] = [];
  const client = new GeminiClient(async req => { requests.push(req); return response({ ok: true }); });
  assert.deepEqual((await generate(client)).value, { ok: true });
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.match(request.url, /gemini-3\.1-flash-lite:generateContent$/);
  assert.deepEqual(JSON.parse(request.body).generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  assert.equal(JSON.parse(request.body).generationConfig.temperature, 1);
  assert.equal(request.headers['x-goog-api-key'], 'dummy-secret');
  assert.ok(!request.url.includes('dummy-secret'));
  assert.ok(!request.body.includes('dummy-secret'));
  assert.equal(JSON.parse(request.body).generationConfig.responseMimeType, 'application/json');
});
// 일시 오류만 한 번 재시도하고 인증·사용량·모델 오류는 즉시 종료하는지 확인한다.
test('temporary HTTP/network failures retry only once; authentication, quota and model errors never retry', async () => {
  for (const status of [408, 500, 502, 503, 504, 400, 401, 403, 404, 429]) {
    let calls = 0;
    const client = new GeminiClient(async () => { calls++; return { status, text: 'dummy-secret body' }; }, async () => {});
    await assert.rejects(generate(client), error => error instanceof Error && !error.message.includes('dummy-secret'));
    assert.equal(calls, [408, 500, 502, 503, 504].includes(status) ? 2 : 1);
  }
  let calls = 0;
  const network = new GeminiClient(async () => { calls++; throw new Error('dummy-secret'); }, async () => {});
  await assert.rejects(generate(network), /네트워크/); assert.equal(calls, 2);
  calls = 0;
  const recovery = new GeminiClient(async () => ++calls === 1 ? { status: 503, text: '' } : response({ recovered: true }), async () => {});
  assert.deepEqual((await generate(recovery)).value, { recovered: true }); assert.equal(calls, 2);
});
// 차단·잘림·빈 응답·잘못된 JSON·복수 후보를 본문 노출이나 재시도 없이 거부하는지 확인한다.
test('blocked, truncated, empty, invalid JSON and multiple candidates fail without response leakage or retry', async () => {
  for (const text of [
    'dummy-secret', '{}', JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }),
    JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }] }),
    JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'dummy-secret' }] } }] }),
    JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }),
    JSON.stringify({ candidates: [{}, {}] }),
  ]) {
    let calls = 0;
    await assert.rejects(generate(new GeminiClient(async () => { calls++; return { status: 200, text }; })), /JSON/);
    assert.equal(calls, 1);
  }
});
// 동시 호출을 막고 시간 초과 뒤에도 실제 HTTP가 끝날 때까지 잠금을 유지하는지 확인한다.
test('concurrent requests rejected; timeout retains lock until transport ends and never retries', async () => {
  let finish!: (r: HttpResponse) => void;
  let calls = 0;
  const client = new GeminiClient(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, async () => {}, 10);
  const pending = generate(client);
  await assert.rejects(generate(client), /진행 중/);
  await assert.rejects(pending, /시간/);
  await assert.rejects(generate(client), /진행 중/);
  finish({ status: 503, text: 'late' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  client.close(); await assert.rejects(generate(client), /종료/);
});
// 재시도 대기 중 플러그인이 종료되면 추가 전송이 발생하지 않는지 확인한다.
test('unload during retry delay prevents another request', async () => {
  let calls = 0;
  const client = new GeminiClient(async () => { calls++; return { status: 503, text: '' }; }, async () => { client.close(); });
  await assert.rejects(generate(client), /종료/); assert.equal(calls, 1);
});
