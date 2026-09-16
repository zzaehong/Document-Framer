/** 원문 언어·분류 계약과 전송 지침을 검증한다. 실제 모델 품질 평가는 fixture로 별도 수행한다. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { framingEvaluation } from './fixtures/framing-evaluation';
import { CONTENT_NATURES, RESPONSE_SCHEMA, RESPONSE_SCHEMA_VERSION } from '../src/classification';
import { EXTRACTION_SCHEMA, CONCEPT_SCHEMA_VERSION, CONSOLIDATION_VERSION } from '../src/concepts';
import { EXTRACTION_PROMPT, CONSOLIDATION_PROMPT, EXTRACTION_PROMPT_VERSION, CONSOLIDATION_PROMPT_VERSION } from '../src/concept-prompts';
import { SYSTEM_PROMPT, PROMPT_VERSION } from '../src/classification-prompt';
import { BUDGET, PIPELINE_VERSION } from '../src/budget';
import { GeminiClient } from '../src/gemini';
import { GeminiFramer } from '../src/framing';
const response = (value: unknown) => ({ status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }) });

for (const fixture of framingEvaluation) test(`source-language and content-nature contract: ${fixture.id}`, async () => {
  const source = { path: `${fixture.id}.md`, basename: fixture.id, text: fixture.text, ctime: 0, mtime: 0 };
  const framer = new GeminiFramer(new GeminiClient(async request => {
    const body = JSON.parse(request.body);
    assert.equal(body.systemInstruction.parts[0].text, EXTRACTION_PROMPT);
    const input = JSON.parse(body.contents[0].parts[0].text);
    assert.equal(input.contextMarkdown, fixture.text);
    return response({ domains: [{ path: ['Other'], source: 'unclassified', confidence: 0 }],
      contentNature: { id: fixture.expected, confidence: 0.8 }, concepts: fixture.concepts.map(concept => ({ concept, confidence: 0.9 })) });
  }));
  const preview = await framer.generate(source, 'test-key');
  assert.deepEqual(preview.frame.concepts.map(c => c.concept), fixture.concepts);
  assert.equal(preview.frame.document.contentNature.id, fixture.expected);
  assert.equal(preview.frame.schemaVersion, 5);
  assert.ok(!('type' in preview.frame.document));
  assert.equal(preview.sourceText, fixture.text);
});

test('extraction and aggregation prompts specify dominant nature and language preservation', () => {
  for (const prompt of [EXTRACTION_PROMPT, SYSTEM_PROMPT]) {
    assert.match(prompt, /Do not choose mixed merely because both information and opinion appear somewhere/);
    assert.match(prompt, /Choose the dominant nature when the secondary nature is minor/);
    assert.match(prompt, /do not use majority vote/);
    for (const id of CONTENT_NATURES) assert.ok(prompt.includes(id));
  }
  for (const prompt of [EXTRACTION_PROMPT, CONSOLIDATION_PROMPT]) {
    assert.match(prompt, /PRESERVE SOURCE LANGUAGE/);
    assert.match(prompt, /Do not translate a concept merely to normalize it/);
    assert.match(prompt, /Do not convert Korean concepts into English canonical terms/);
    assert.match(prompt, /Do not convert English technical terms into Korean/);
    assert.ok(prompt.includes('자본자산 가격결정 모형(CAPM)'));
  }
  assert.match(CONSOLIDATION_PROMPT, /choose a Korean candidate, not Diversification/);
  assert.deepEqual((RESPONSE_SCHEMA.properties.contentNature as { properties: { id: { enum: readonly string[] } } }).properties.id.enum, CONTENT_NATURES);
  assert.deepEqual(Object.keys((EXTRACTION_SCHEMA.properties.concepts as { items: { properties: Record<string, unknown> } }).items.properties), ['concept', 'confidence']);
});

test('whole-document nature uses the aggregation response, not a chunk majority, and versions are traceable', async () => {
  const text = `# 정보 A\n\n${'설명 '.repeat(800)}\n\n# 정보 B\n\n${'정보 '.repeat(800)}\n\n# 의견\n\n${'내 판단 '.repeat(1200)}`;
  let chunk = 0;
  const preview = await new GeminiFramer(new GeminiClient(async request => {
    const body = JSON.parse(request.body), input = JSON.parse(body.contents[0].parts[0].text);
    const domains = [{ path: ['Other'], source: 'unclassified', confidence: 0 }];
    if (input.contextMarkdown) return response({ domains, contentNature: { id: ++chunk <= 2 ? 'information' : 'opinion', confidence: 0.8 }, concepts: [] });
    assert.equal(body.systemInstruction.parts[0].text, SYSTEM_PROMPT);
    assert.deepEqual(input.chunks.map((c: any) => c.contentNature.id), ['information', 'information', 'opinion']);
    assert.ok(input.chunks.every((c: any) => c.sourceBytes > 0));
    return response({ domains, contentNature: { id: 'mixed', confidence: 0.7 } });
  })).generate({ path: 'mixed.md', basename: 'mixed', text, ctime: 0, mtime: 0 }, 'key');
  assert.equal(preview.frame.document.contentNature.id, 'mixed');
  const [extraction, , , document] = preview.frame.processing.calls.map(c => c.trace);
  assert.equal(extraction.promptVersion, EXTRACTION_PROMPT_VERSION);
  assert.equal(extraction.responseSchemaVersion, CONCEPT_SCHEMA_VERSION);
  assert.equal(document.promptVersion, PROMPT_VERSION);
  assert.equal(document.responseSchemaVersion, RESPONSE_SCHEMA_VERSION);
  assert.equal(document.pipelineVersion, PIPELINE_VERSION);
  assert.equal(document.consolidationPromptVersion, CONSOLIDATION_PROMPT_VERSION);
  assert.equal(document.consolidationVersion, CONSOLIDATION_VERSION);
  assert.deepEqual(document.processingBudget, BUDGET);
});
