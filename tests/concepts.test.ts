/**
 * 새 사용자 결정 A~I를 검증한다. HTTP는 고정 응답으로 대체한다.
 * 실제 문서/긴 문자열을 사용하되 모델 의미 품질과 계약 검증을 혼동하지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { structuralChunks, CHUNKER_VERSION } from '../src/chunks';
import { BUDGET, byteLength } from '../src/budget';
import { validateExtraction, mergeExactCandidates, validateConsolidation, needsSemanticConsolidation, conceptKey } from '../src/concepts';
import { GeminiClient, HttpRequest, HttpResponse } from '../src/gemini';
import { GeminiFramer } from '../src/framing';
import { AttemptJournal } from '../src/attempts';
import { FrameStore } from '../src/storage';
import { sourceHash } from '../src/evaluation';

const classification = { domains: [{ path: ['Economics'], source: 'new', confidence: 0.8 }], type: { id: 'informational', confidence: 0.8 } };
const evidence = (blockIds: string[]) => ({ blockIds, labels: [{ id: 'claim', confidence: 0.7 }] });
const concept = (name: string, groups: string[][]) => ({ concept: name, confidence: 0.8, evidence: groups.map(evidence) });
const extraction = (concepts: unknown[]) => ({ ...classification, concepts });
const envelope = (value: unknown): HttpResponse => ({ status: 200, text: JSON.stringify({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }, candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }) });
const inputOf = (request: HttpRequest) => JSON.parse(JSON.parse(request.body).contents[0].parts[0].text);
const source = (text: string) => ({ path: 'long.md', basename: 'long', ctime: 0, mtime: 0, text });
// 2 KiB 이상의 섹션 둘로 실제 heading 분할을 유도한다.
const twoSections = `# First\n\n${'분산투자 근거. '.repeat(250)}\n\n# Second\n\n${'포트폴리오 근거. '.repeat(250)}`;

test('A/B: four of ten blocks and non-contiguous evidence are valid; gaps stay in raw source', () => {
  const text = Array.from({ length: 10 }, (_, i) => `원문 ${i + 1} 😀`).join('\r\n\r\n');
  const { blocks } = structuralChunks(text);
  const value = extraction([concept('Diversification', [['b2'], ['b7'], ['b9', 'b10']])]);
  const result = validateExtraction(value, blocks, [], 'chunk-1');
  assert.equal(result.concepts[0].evidence.length, 3);
  assert.deepEqual(result.concepts[0].evidence.flatMap(e => e.blockIds), ['b2', 'b7', 'b9', 'b10']);
  for (const span of result.concepts[0].evidence) {
    assert.equal(span.startOffset, blocks.find(b => b.id === span.blockIds[0])!.source.startOffset);
    assert.ok(text.slice(span.startOffset, span.endOffset).startsWith('원문'));
  }
  assert.ok(text.includes('원문 6'));
});

test('C: zero concepts is a completed result and headings alone do not create concepts', async () => {
  const framer = new GeminiFramer(new GeminiClient(async () => envelope(extraction([]))));
  const preview = await framer.generate(source('# 목차\n\n안내 문구'), 'key');
  assert.deepEqual(preview.frame.concepts, []); assert.equal(preview.frame.processing.completedChunks, 1);
  assert.equal(preview.frame.processing.calls.length, 1);
});

test('D: cross-chunk semantic names merge by candidate IDs and retain distant source evidence', async () => {
  const inputs: any[] = [];
  const journal = new AttemptJournal(async () => {});
  let chunk = 0;
  const framer = new GeminiFramer(new GeminiClient(async request => {
    const input = inputOf(request); inputs.push(input);
    if (input.blocks) return envelope(extraction([concept(chunk++ === 0 ? 'Diversification' : 'Portfolio Diversification', [[input.blocks[1].id]])]));
    if (input.candidates) return envelope({ groups: [{ concept: 'Diversification', candidateIds: input.candidates.map((c: any) => c.candidateId) }] });
    return envelope(classification);
  }, undefined, 1000, journal));
  const preview = await framer.generate(source(twoSections), 'key');
  assert.equal(preview.frame.processing.chunkCount, 2); assert.equal(preview.frame.concepts.length, 1);
  assert.equal(preview.frame.concepts[0].concept, 'Diversification');
  assert.equal(preview.frame.concepts[0].evidence.length, 2);
  assert.equal(inputs.length, 4);
  const consolidation = inputs.find(input => input.candidates);
  assert.deepEqual(Object.keys(consolidation.candidates[0]), ['candidateId', 'concept', 'chunkIds']);
  assert.ok(!JSON.stringify(consolidation).includes('분산투자 근거'));
  const document = inputs.find(input => input.chunks);
  assert.equal(document.chunks.length, 2); assert.ok(!JSON.stringify(document).includes('분산투자 근거'));
  assert.deepEqual(journal.attempts.map(a => a.trace?.stage), ['concept-extraction', 'concept-extraction', 'concept-consolidation', 'document-classification']);
  assert.equal(new Set(journal.attempts.map(a => a.trace?.framingRunId)).size, 1);
  assert.equal(new Set(journal.attempts.map(a => a.id)).size, 4);
  assert.ok(!JSON.stringify(journal.attempts).includes('분산투자 근거'));
  for (const [index, a] of journal.attempts.entries()) {
    assert.equal(a.trace?.chunkerVersion, CHUNKER_VERSION);
    assert.equal(a.trace?.sourceHash, await sourceHash(twoSections));
    assert.equal(a.trace?.inputHash, await sourceHash(JSON.stringify(inputs[index])));
  }
  // data.json은 기존 v3에 추적 확장만 보관하며 재시작 복원도 가능하다.
  const store = new FrameStore(async () => {}); await store.saveAttempts(journal.attempts);
  const reload = new FrameStore(async () => {}); reload.load(structuredClone(store.state));
  assert.equal(reload.state.attempts.length, 4);
});

test('E: normalized duplicates use deterministic merge without a consolidation API call', async () => {
  let calls = 0;
  const framer = new GeminiFramer(new GeminiClient(async request => {
    calls++; const input = inputOf(request);
    if (input.candidates) assert.fail('Exact duplicate names must not cause semantic consolidation');
    return input.blocks ? envelope(extraction([concept(calls === 1 ? 'Diversification' : 'DIVERSIFICATION', [[input.blocks[1].id]])])) : envelope(classification);
  }));
  const preview = await framer.generate(source(twoSections), 'key');
  assert.equal(preview.frame.concepts.length, 1); assert.equal(calls, 3, 'two extractions plus document classification');
  assert.equal(preview.frame.concepts[0].evidence.length, 2);
  assert.equal(conceptKey('Cafe\u0301'), conceptKey('CAFÉ'));
});

test('F: unknown, duplicated, nonadjacent or cross-chunk evidence and generated summaries are rejected', () => {
  const { blocks } = structuralChunks('A\n\nB\n\nC');
  const bad = [
    concept('C', [['b99']]), concept('C', [['b1', 'b3']]), concept('C', [['b1'], ['b1']]),
    { ...concept('C', [['b1']]), summary: 'Invented summary' },
    { ...concept('C', [['b1']]), evidence: [{ ...evidence(['b1']), startOffset: 0 }] },
    { ...concept('C', [['b1']]), evidence: [{ ...evidence(['b1']), text: 'Invented source' }] },
    { ...concept('C', [['b1']]), evidence: [] }, concept('', [['b1']]), concept('x'.repeat(121), [['b1']]),
  ];
  for (const value of bad) assert.throws(() => validateExtraction(extraction([value]), blocks, [], 'chunk-1'));
  assert.throws(() => validateExtraction(extraction([concept('C', [['b3']])]), blocks.slice(0, 2), [], 'chunk-1'));
});

test('structural chunks preserve all parser content, CRLF and Unicode even inside huge blocks and lines', () => {
  const texts = [
    `# 제목\r\n\r\n${'😀한글 '.repeat(6000)}\r\n끝`,
    `\uFEFF---\r\n${'x: 값\r\n'.repeat(5000)}---\r\n`,
    `~~~md\n${'# 코드 내부\n'.repeat(5000)}~~~\n`,
    `${'x'.repeat(BUDGET.maxChunkBytes - 1)}\r\n끝`,
  ];
  for (const text of texts) {
    const planned = structuralChunks(text);
    assert.ok(planned.chunks.length > 1);
    const covered = new Uint8Array(text.length);
    for (const block of planned.blocks) {
      const range = block.source;
      assert.equal(text.slice(range.startOffset, range.endOffset), block.text);
      assert.ok(!/[\uD800-\uDBFF]$/.test(block.text));
      assert.ok(!/^[\uDC00-\uDFFF]/.test(block.text));
      assert.equal(range.startLine, (text.slice(0, range.startOffset).match(/\r\n|\r|\n/g) ?? []).length + 1);
      const endText = text.slice(0, range.endOffset).replace(/(?:\r\n|\r|\n)$/, '');
      assert.equal(range.endLine, (endText.match(/\r\n|\r|\n/g) ?? []).length + 1);
      for (let i = range.startOffset; i < range.endOffset; i++) { assert.equal(covered[i], 0); covered[i] = 1; }
    }
    for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) assert.equal(covered[i], 1);
    for (const chunk of planned.chunks) { assert.ok(chunk.bytes <= BUDGET.maxChunkBytes); assert.ok(chunk.blocks.length <= BUDGET.maxBlocksPerChunk); }
    assert.deepEqual(structuralChunks(text), planned);
  }
});

test('heading boundaries split substantive sections, merge small sections and preserve continued heading context', () => {
  assert.equal(structuralChunks('# A\n\nsmall\n\n## B\n\nsmall').chunks.length, 1);
  const sections = structuralChunks(twoSections).chunks;
  assert.equal(sections.length, 2); assert.match(sections[1].blocks[0].text, /Second/);
  const large = structuralChunks(`# A\n\n${'text '.repeat(10000)}`).chunks;
  assert.ok(large.length > 2);
  assert.ok(large.slice(1).every(chunk => chunk.headingContext.some(text => text.includes('# A'))));
});

test('G: old 64 KiB / 128-block limit is replaced by multiple bounded requests', async () => {
  const text = Array.from({ length: 180 }, (_, i) => `## ${i}\n\n${'근거 '.repeat(100)}`).join('\n\n');
  assert.ok(byteLength(text) > 64 * 1024);
  let calls = 0;
  const framer = new GeminiFramer(new GeminiClient(async request => {
    calls++; const input = inputOf(request);
    assert.ok(byteLength(JSON.stringify(input)) <= BUDGET.maxInputBytes);
    if (input.blocks) {
      assert.ok(input.blocks.length <= BUDGET.maxBlocksPerChunk);
      assert.ok(byteLength(input.blocks.map((b: any) => b.text).join('')) <= BUDGET.maxChunkBytes);
      return envelope(extraction([]));
    }
    return envelope(classification);
  }));
  const preview = await framer.generate(source(text), 'key');
  assert.ok(preview.frame.processing.chunkCount > 1);
  assert.equal(calls, preview.frame.processing.chunkCount + 1);
  assert.equal(preview.sourceText, text); assert.equal(preview.frame.processing.completedChunks, preview.frame.processing.chunkCount);
});

test('H: document/chunk and serialized Catalog input budgets fail before any HTTP', async () => {
  let calls = 0;
  const framer = new GeminiFramer(new GeminiClient(async () => { calls++; return envelope(extraction([])); }));
  for (const text of ['x'.repeat(BUDGET.maxDocumentBytes + 1), '# h\n'.repeat(BUDGET.maxChunks * BUDGET.maxBlocksPerChunk + 1)]) {
    await assert.rejects(framer.generate(source(text), 'key'), /예산/);
  }
  const catalog = Array.from({ length: 1500 }, (_, i) => ({ path: [`${i}${'a'.repeat(75)}`] }));
  await assert.rejects(framer.generate(source('body'), 'key', catalog), /예산/);
  assert.equal(calls, 0);
});

test('I: partial extraction and consolidation failure abort the entire run without later calls', async () => {
  for (const failingStage of ['extraction', 'consolidation', 'document']) {
    let count = 0;
    const framer = new GeminiFramer(new GeminiClient(async request => {
      count++; const input = inputOf(request);
      if ((failingStage === 'extraction' && count === 2) || (failingStage === 'consolidation' && input.candidates) || (failingStage === 'document' && input.chunks)) return { status: 403, text: '{}' };
      if (input.blocks) return envelope(extraction([concept(`Concept ${count}`, [[input.blocks[1].id]])]));
      if (input.candidates) return envelope({ groups: input.candidates.map((c: any) => ({ concept: c.concept, candidateIds: [c.candidateId] })) });
      return envelope(classification);
    }));
    await assert.rejects(framer.generate(source(twoSections), 'key'), /403/);
    assert.equal(count, failingStage === 'extraction' ? 2 : failingStage === 'consolidation' ? 3 : 4);
  }
});

test('consolidation must preserve candidate coverage and cannot introduce source or rename a singleton', () => {
  const { blocks } = structuralChunks('A\n\nB');
  const candidates = [
    ...validateExtraction(extraction([concept('Diversification', [['b1']])]), blocks, [], 'chunk-1').concepts,
    ...validateExtraction(extraction([concept('Portfolio Diversification', [['b2']])]), blocks, [], 'chunk-2').concepts,
  ];
  const [a, b] = candidates.map(c => c.candidateId);
  const invalid = [[], [{ concept: 'D', candidateIds: [a] }], [{ concept: 'D', candidateIds: [a, a, b] }], [{ concept: 'D', candidateIds: [a, 'fake'] }],
    [{ concept: 'Wrong rename', candidateIds: [a] }, { concept: candidates[1].concept, candidateIds: [b] }],
    [{ concept: 'D', candidateIds: [a, b], evidence: ['invented'] }]];
  for (const groups of invalid) assert.throws(() => validateConsolidation({ groups }, candidates, blocks));
  const merged = validateConsolidation({ groups: [{ concept: 'Diversification', candidateIds: [a, b] }] }, candidates, blocks);
  assert.deepEqual(merged[0].evidence.flatMap(e => e.blockIds), ['b1', 'b2']);
  assert.equal(needsSemanticConsolidation(mergeExactCandidates([candidates[0], { ...candidates[1], concept: 'DIVERSIFICATION' }], blocks)), false);
});

test('retry records across multiple calls share document run but never overwrite earlier call attempts', async () => {
  const journal = new AttemptJournal(async () => {});
  let count = 0;
  const framer = new GeminiFramer(new GeminiClient(async request => {
    const input = inputOf(request);
    if (++count === 1) return { status: 503, text: '{}' };
    return envelope(input.blocks ? extraction([]) : classification);
  }, async () => {}, 1000, journal));
  const preview = await framer.generate(source(twoSections), 'key');
  assert.equal(journal.attempts.length, 4); assert.equal(preview.frame.processing.calls.length, 3);
  assert.deepEqual(journal.attempts.map(a => a.attemptNumber), [1, 2, 1, 1]);
  assert.equal(new Set(journal.attempts.map(a => a.id)).size, 4);
  assert.equal(new Set(journal.attempts.map(a => a.trace?.framingRunId)).size, 1);
});

test('timeout or source invalidation stops later chunks; late usage still belongs to the same attempt', async () => {
  const journal = new AttemptJournal(async () => {});
  let finish!: (response: HttpResponse) => void;
  let calls = 0;
  const client = new GeminiClient(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, undefined, 15, journal);
  const framer = new GeminiFramer(client);
  await assert.rejects(framer.generate(source(twoSections), 'key'), /시간/);
  assert.equal(calls, 1); assert.equal(client.status, 'timeout-pending');
  await assert.rejects(framer.generate(source('new body'), 'key'), /HTTP/);
  finish(envelope(extraction([]))); await new Promise(resolve => setImmediate(resolve)); await journal.flush();
  assert.equal(journal.attempts.length, 1); assert.equal(journal.attempts[0].usage.tokens.totalTokenCount, 15);
  assert.equal(client.status, 'idle'); assert.equal(calls, 1);
  let valid = true;
  const invalidating = new GeminiFramer(new GeminiClient(async () => { valid = false; return envelope(extraction([])); }));
  await assert.rejects(invalidating.generate(source(twoSections), 'key', [], 'classification', () => valid), /종료/);
});

test('repository PRD, reading note and project-like long docs are processed offline within chunk budget', async () => {
  const prd = await readFile('Doc/PRD-Document-Framer.md', 'utf8');
  assert.ok(prd.split('\n').length > 500);
  const samples = ['짧은 메모', '## 독서록\n\n책의 주장과 근거.\n\n'.repeat(30), prd, '# 프로젝트\n\n'.repeat(200)];
  for (const text of samples) {
    const planned = structuralChunks(text);
    assert.ok(planned.chunks.length <= BUDGET.maxChunks);
    const framer = new GeminiFramer(new GeminiClient(async request => envelope(inputOf(request).blocks ? extraction([]) : classification)));
    const preview = await framer.generate(source(text), 'key');
    assert.equal(preview.frame.processing.completedChunks, planned.chunks.length);
    assert.equal(preview.sourceText, text);
  }
});

test('candidate output budgets fail explicitly without dropping concepts or calling consolidation', async () => {
  const { blocks } = structuralChunks('Evidence');
  assert.throws(() => validateExtraction(extraction(Array.from({ length: BUDGET.maxConceptsPerChunk + 1 }, (_, i) => concept(`C${i}`, [['b1']]))), blocks, [], 'chunk-1'));
  const text = Array.from({ length: 9 }, (_, i) => `# ${i}\n\n${'내용 '.repeat(700)}`).join('\n\n');
  let calls = 0;
  const framer = new GeminiFramer(new GeminiClient(async request => {
    calls++; const input = inputOf(request); assert.ok(input.blocks);
    return envelope(extraction(Array.from({ length: 16 }, (_, i) => concept(`C${calls}-${i}`, [[input.blocks[1].id]]))));
  }));
  await assert.rejects(framer.generate(source(text), 'key'), /예산/);
  assert.equal(calls, 9);
});

test('maximum planned document stays within 34 logical requests and 68 HTTP attempts including retries', async () => {
  const text = Array.from({ length: BUDGET.maxChunks }, (_, i) => `# Section ${i}\n\n${'a'.repeat(2200)}`).join('\n\n');
  assert.equal(structuralChunks(text).chunks.length, BUDGET.maxChunks);
  let calls = 0;
  const journal = new AttemptJournal(async () => {});
  const framer = new GeminiFramer(new GeminiClient(async request => {
    calls++;
    if (calls % 2 === 1) return { status: 503, text: '{}' };
    const input = inputOf(request);
    if (input.blocks) return envelope(extraction([concept(`Concept ${calls}`, [[input.blocks[1].id]])]));
    if (input.candidates) return envelope({ groups: input.candidates.map((c: any) => ({ concept: c.concept, candidateIds: [c.candidateId] })) });
    return envelope(classification);
  }, async () => {}, 1000, journal));
  const preview = await framer.generate(source(text), 'key');
  assert.equal(preview.frame.processing.calls.length, BUDGET.maxLogicalRequests);
  assert.equal(calls, BUDGET.maxHttpAttempts); assert.equal(journal.attempts.length, BUDGET.maxHttpAttempts);
});
