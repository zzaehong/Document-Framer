/** 승인 Catalog와 AI 응답의 경계: 의미 품질은 실제 모델 평가, 계약과 보존은 오프라인으로 검증한다. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Domain, decodeDomains } from '../src/domains';
import { Classification, validateClassification, RESPONSE_SCHEMA_VERSION } from '../src/classification';
import { PROMPT_VERSION, SYSTEM_PROMPT } from '../src/classification-prompt';
import { extractBlocks } from '../src/blocks';
import { FrameStore, decodeSaved, MODEL, SECRET_ID } from '../src/storage';
import { TestEngine } from '../src/core';
import { GeminiFramer } from '../src/framing';
import { GeminiClient, HttpRequest, HttpResponse } from '../src/gemini';
import { AttemptJournal } from '../src/attempts';
import { sourceHash, GENERATION_CONFIG } from '../src/evaluation';

const catalog = [{ path: ['Economics'] }];
const source = { path: 'economics.md', basename: 'economics', text: '행동경제학에서는 손실 회피가 의사 결정에 영향을 준다.', ctime: 0, mtime: 0 };
const blocks = extractBlocks(source.text);
const result = (domains: Classification['domains']): Classification => ({ domains, type: { id: 'informational', confidence: 0.8 }, units: [{ blockIds: ['b1'], labels: [{ id: 'claim', confidence: 0.7 }, { id: 'observation', confidence: 0.4 }] }] });
const existing = () => result([{ path: ['Economics'], source: 'existing', confidence: 0.9 }]);
const response = (value: unknown): HttpResponse => ({ status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }) });

test('AC-A/B: reuse known paths and allow new reusable multi-domain paths with three levels', () => {
  assert.deepEqual(validateClassification(existing(), blocks, catalog), existing());
  const candidate = result([{ path: ['Science', 'Biology', 'Genetics'], source: 'new', confidence: 0.8 }, { path: ['Economics'], source: 'existing', confidence: 0.6 }]);
  assert.deepEqual(validateClassification(candidate, blocks, catalog), candidate);
  assert.deepEqual(catalog, [{ path: ['Economics'] }]);
  // 지침의 예시와 재사용 우선 규칙이 전송 프롬프트에 존재하는지 확인한다. 의미 품질의 증거는 아니다.
  assert.match(SYSTEM_PROMPT, /behavioral economics document should reuse/);
  assert.match(SYSTEM_PROMPT, /An empty or insufficient catalog is NOT a reason/);
});

test('AC-E: unknown existing, case variants, malformed paths and duplicate domains fail without correction', () => {
  const bad: unknown[] = [
    [], [''], [' Economics'], ['Economics '], ['Computer  Science'], ['A\nB'], ['A\tB'], ['A\u200bB'],
    ['e\u0301'], ['x'.repeat(81)], ['a', 'b', 'c', 'd'], ['Science', 'science'], ['A', 1], ['\ud800'],
  ];
  for (const path of bad) {
    const value: any = existing(); value.domains = [{ path, source: 'new', confidence: 0.8 }];
    const before = structuredClone(value);
    assert.throws(() => validateClassification(value, blocks, catalog));
    assert.deepEqual(value, before);
  }
  const domains: any[] = [
    [{ path: ['Behavioral Economics'], source: 'existing', confidence: 0.8 }],
    [{ path: ['economics'], source: 'existing', confidence: 0.8 }],
    [{ path: ['ECONOMICS'], source: 'new', confidence: 0.8 }],
    [{ path: ['Economics'], source: 'new', confidence: 0.8 }],
    [{ path: ['Biology'], source: 'unknown', confidence: 0.8 }],
    [{ path: ['Biology'], source: 'unclassified', confidence: 0.8 }],
    [{ path: ['Other'], source: 'new', confidence: 0 }],
    [{ path: ['Other'], source: 'existing', confidence: 0 }],
    [{ path: ['Other', 'Biology'], source: 'unclassified', confidence: 0 }],
    [{ path: ['other'], source: 'unclassified', confidence: 0 }],
    [{ path: ['Biology'], source: 'new', confidence: Infinity }],
    [{ path: ['Biology'], source: 'new', confidence: '0.8' }],
    [{ path: ['Biology'], source: 'new', confidence: 0.8, extra: true }],
    [{ path: ['Biology'], source: 'new', confidence: 0.8 }, { path: ['biology'], source: 'new', confidence: 0.4 }],
    [{ path: ['Other'], source: 'unclassified', confidence: 0 }, { path: ['Economics'], source: 'existing', confidence: 0.8 }],
  ];
  for (const invalid of domains) assert.throws(() => validateClassification(result(invalid), blocks, catalog));
  const other = result([{ path: ['Other'], source: 'unclassified', confidence: 0 }]);
  assert.deepEqual(validateClassification(other, blocks, []), other);
  assert.doesNotThrow(() => validateClassification(result([{ path: ['é', '한글', '😀'], source: 'new', confidence: 0.5 }]), blocks, []));
});

test('v1/v2 migrate to empty Catalog without mutating Frames or legacy traces; invalid v3 is rejected', () => {
  const frame = new TestEngine().generate(source);
  const attempt = { id: 'old:1', revision: 1, sessionId: 'old', runId: 'old', purpose: 'classification', transport: 'settled', usage: { status: 'unknown', tokens: {} }, trace: { promptVersion: 'classification-v1', responseSchemaVersion: 'classification-schema-v1' } };
  for (const version of [1, 2]) {
    const old = { version, settings: { model: MODEL, secretId: SECRET_ID }, frames: { a: frame }, attempts: [attempt] };
    const before = structuredClone(old);
    const next = decodeSaved(old);
    assert.equal(next.version, 3); assert.deepEqual(next.domains, []);
    assert.deepEqual(next.frames.a, frame); assert.deepEqual(next.attempts, [attempt]); assert.deepEqual(old, before);
  }
  const current = decodeSaved(null);
  for (const domains of [undefined, null, {}, [{ path: ['Other'] }], [{ path: [] }], [...catalog, { path: ['economics'] }], [{ path: ['Biology'], approved: false }]]) {
    assert.throws(() => decodeSaved({ ...current, domains }));
  }
});

test('Catalog saves serialize with Frames/settings/journal, deduplicate approvals, preserve failed state and reload', async () => {
  let saved: unknown;
  let fail = false;
  const store = new FrameStore(async data => { if (fail) throw new Error('disk'); saved = structuredClone(data); });
  const journal = new AttemptJournal(attempts => store.saveAttempts(attempts));
  const client = new GeminiClient(async () => response(existing()), undefined, 1000, journal);
  const frame = new TestEngine().generate(source);
  await Promise.all([store.saveDomain(catalog[0]), store.saveFrame('a', frame), store.saveSettings(), store.saveDomain(catalog[0]), client.generate('key', 'system', {}, {})]);
  assert.deepEqual(store.getDomains(), catalog); assert.equal(store.state.attempts.length, 1); assert.deepEqual(store.state.frames.a, frame);
  const copy = store.getDomains(); copy[0].path[0] = 'mutated'; assert.deepEqual(store.getDomains(), catalog);
  await assert.rejects(store.saveDomain({ path: ['economics'] }));
  const before = store.state;
  fail = true; await assert.rejects(store.saveDomain({ path: ['Biology'] })); assert.equal(store.state, before);
  fail = false; await store.saveDomain({ path: ['Biology'] });
  const next = new FrameStore(async () => {}); next.load(saved);
  assert.deepEqual(next.getDomains(), [...catalog, { path: ['Biology'] }]);
  assert.equal(next.state.attempts.length, 1); assert.deepEqual(next.state.frames.a, frame);
});

test('framer sends and validates the same Catalog snapshot, tracks prefix hash without logging names', async () => {
  const inputs: HttpRequest[] = [];
  const journal = new AttemptJournal(async () => {});
  const mutable: Domain[] = structuredClone(catalog);
  const framer = new GeminiFramer(new GeminiClient(async request => { inputs.push(request); return response(existing()); }, undefined, 1000, journal));
  const pending = framer.generate(source, 'key', mutable);
  mutable.push({ path: ['Biology'] }); mutable[0].path[0] = 'Changed';
  const preview = await pending;
  const sent = JSON.parse(JSON.parse(inputs[0].body).contents[0].parts[0].text);
  assert.deepEqual(sent.existingDomains, catalog);
  assert.equal(preview.frame.document.domains[0].source, 'existing');
  const trace = preview.frame.evaluation;
  assert.equal(trace.promptVersion, PROMPT_VERSION); assert.equal(trace.responseSchemaVersion, RESPONSE_SCHEMA_VERSION);
  assert.equal(trace.domainCatalogHash, await sourceHash(JSON.stringify(catalog)));
  assert.equal(trace.domainCatalogCount, 1); assert.equal(trace.domainCatalogEncoding, 'catalog-json-v1');
  assert.deepEqual(trace.generationConfig, GENERATION_CONFIG);
  assert.ok(!JSON.stringify(journal.attempts).includes('Economics'));
  assert.ok(!JSON.stringify(journal.attempts).includes(source.text));
  const grown = [...catalog, { path: ['Biology'] }];
  assert.equal(await sourceHash(JSON.stringify(grown.slice(0, trace.domainCatalogCount))), trace.domainCatalogHash);
  await framer.checkConnection('key', catalog);
  assert.deepEqual(JSON.parse(JSON.parse(inputs[1].body).contents[0].parts[0].text).existingDomains, catalog);
  assert.equal(journal.attempts[1].purpose, 'connection');
});

test('Catalog additions during HTTP cannot legitimize an invented existing response', async () => {
  const mutable = structuredClone(catalog);
  const framer = new GeminiFramer(new GeminiClient(async () => {
    mutable.push({ path: ['Biology'] });
    return response(result([{ path: ['Biology'], source: 'existing', confidence: 0.8 }]));
  }));
  await assert.rejects(framer.generate(source, 'key', mutable), /검증 실패/);
  assert.deepEqual(decodeDomains(mutable), [...catalog, { path: ['Biology'] }]);
});
