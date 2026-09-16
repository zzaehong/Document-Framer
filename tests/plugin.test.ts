/** 기존 동작을 확인하는 자동 테스트. 각 사례 위 주석은 보장하려는 조건을 설명한다. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import type { HttpRequest, HttpResponse } from '../src/gemini';

const code = buildSync({ entryPoints: ['src/main.ts'], bundle: true, external: ['obsidian'], format: 'cjs', write: false }).outputFiles[0].text;
async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 1000 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.ok(predicate(), 'async operation did not reach expected state');
}
// Obsidian의 파일·화면·저장소·HTTP를 가짜 객체로 대체한다. advance()로 실제 60초 대기 없이 시간을 진행한다.
function harness() {
  let now = 100_000;
  let saved: unknown = null;
  let failSave = false;
  const events: Record<string, (...args: any[]) => void> = {};
  const vaultEvents: Record<string, (...args: any[]) => void> = {};
  const secrets = new Map<string, string>();
  const requests: HttpRequest[] = [];
  const settings: any[] = [];
  const modals: any[] = [];
  let settingsTab: any;
  let responder = async (request: HttpRequest): Promise<HttpResponse> => {
    const input = JSON.parse(JSON.parse(request.body).contents[0].parts[0].text);
    return { status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
      domains: [{ path: ['Other'], source: 'unclassified', confidence: 0.3 }], type: { id: 'idea-note', confidence: 0.6 },
      concepts: [{ concept: 'Reusable concept', confidence: 0.7, evidence: input.blocks.map((b: any) => ({ blockIds: [b.id], labels: [{ id: 'idea', confidence: 0.5 }] })) }],
    }) }] } }] }) };
  };
  class Element {
    text = ''; tag = ''; children: Element[] = []; disabled = false; onclick?: () => void; open = false;
    empty() { this.children = []; } addClass() {}
    createEl(_tag: string, options?: { text?: string }) { const el = new Element(); el.tag = _tag; el.text = options?.text ?? ''; this.children.push(el); return el; }
    setText(value: string) { this.text = value; }
  }
  class Text {
    value = ''; inputEl = { type: '', autocomplete: '' };
    getValue() { return this.value; } setValue(value: string) { this.value = value; return this; } setPlaceholder() { return this; }
  }
  class Button {
    text = ''; disabled = false; click: () => unknown = () => {};
    setButtonText(value: string) { this.text = value; return this; }
    onClick(cb: () => unknown) { this.click = cb; return this; }
    setDisabled(value: boolean) { this.disabled = value; return this; }
  }
  class Setting {
    name = ''; text?: Text; buttons: Button[] = [];
    constructor(_el: Element) { settings.push(this); }
    setName(value: string) { this.name = value; return this; } setDesc() { return this; }
    addText(cb: (text: Text) => void) { this.text = new Text(); cb(this.text); return this; }
    addButton(cb: (button: Button) => void) { const b = new Button(); this.buttons.push(b); cb(b); return this; }
  }
  class Modal {
    contentEl = new Element();
    constructor(_app: unknown) {}
    open() { modals.push(this); (this as any).onOpen(); }
  }
  class TFile { path = 'test.md'; basename = 'test'; extension = 'md'; stat = { ctime: 0, mtime: now }; }
  const file = new TFile();
  let content = '# 테스트\n원문';
  class Plugin {
    app = {
      secretStorage: { getSecret: (id: string) => secrets.get(id) ?? null, setSecret: (id: string, value: string) => { secrets.set(id, value); } },
      workspace: { getActiveFile: () => file, getActiveViewOfType: () => ({ file, editor: { getValue: () => content } }), getLeavesOfType: () => [], getRightLeaf: () => null, on: (name: string, fn: (...args: any[]) => void) => { events[name] = fn; } },
      vault: { on: (name: string, fn: (...args: any[]) => void) => { vaultEvents[name] = fn; }, getAbstractFileByPath: () => file, read: async () => content },
    };
    loadData = async () => saved;
    saveData = async (value: unknown) => { if (failSave) throw new Error('disk full'); saved = structuredClone(value); };
    registerView() {} addRibbonIcon() {} addCommand() {} registerEvent() {} registerInterval() {} addSettingTab(tab: unknown) { settingsTab = tab; }
  }
  // 번들을 별도 실행 문맥에서 로드하고 모듈·시계·HTTP를 위 테스트용 구현에 연결한다.
  const context = { module: { exports: {} as any }, require: () => ({ Plugin, TFile, ItemView: class {}, Modal, MarkdownView: class {}, Notice: class {}, Setting,
    PluginSettingTab: class { containerEl = new Element(); },
    requestUrl: async (request: HttpRequest) => { requests.push(request); return responder(request); },
  }), window: { setInterval: () => 1 }, TextEncoder, crypto: webcrypto, structuredClone, setTimeout, clearTimeout, Date: class extends Date { static now() { return now; } } };
  vm.runInNewContext(code, context);
  const create = () => new context.module.exports.default();
  return { create, file, createFile: () => new TFile(), events, vaultEvents, secrets, requests, settings, modals, get settingsTab() { return settingsTab; },
    respond(fn: typeof responder) { responder = fn; }, seed(value: unknown) { saved = value; },
    get content() { return content; }, set content(value: string) { content = value; }, advance(ms: number) { now += ms; }, failSave() { failSave = true; }, recoverSave() { failSave = false; }, get saved() { return saved; } };
}
// 삭제·이름 변경·경로 복귀·재사용 뒤 늦은 성공이나 실패가 이전 화면 상태를 되살리지 않는지 확인한다.
test('late success/failure cannot restore previews or statuses after delete, rename, return or path reuse', async () => {
  for (const change of ['delete', 'rename', 'return', 'reuse']) for (const success of [true, false]) {
    const h = harness(); const plugin = h.create(); await plugin.onload(); plugin.key.save('key'); h.advance(60_000);
    let finish!: (value: HttpResponse) => void;
    h.respond(() => new Promise(resolve => { finish = resolve; }));
    const pending = plugin.request(true);
    await waitFor(() => h.requests.length === 1);
    if (change === 'delete' || change === 'reuse') h.vaultEvents.delete(h.file);
    else { h.file.path = 'moved.md'; h.vaultEvents.rename(h.file, 'test.md'); }
    if (change === 'return') { h.file.path = 'test.md'; h.vaultEvents.rename(h.file, 'moved.md'); }
    if (change === 'delete') plugin.app.vault.getAbstractFileByPath = () => null;
    if (change === 'reuse') plugin.app.vault.getAbstractFileByPath = () => ({ ...h.file });
    finish(success ? { status: 200, text: JSON.stringify({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }, candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ domains: [{ path: ['Other'], source: 'unclassified', confidence: 0 }], type: { id: 'idea-note', confidence: 0 }, concepts: [{ concept: 'Reusable concept', confidence: 0.7, evidence: [{ blockIds: ['b1', 'b2'], labels: [{ id: 'idea', confidence: 0 }] }] }] }) }] } }] }) } : { status: 403, text: '' });
    await pending;
    assert.equal(plugin.previews.has('test.md'), false, change);
    assert.equal(plugin.previewStatuses.has('test.md'), false, change);
    assert.equal((h.saved as any).attempts.length, 1);
    assert.equal((h.saved as any).attempts[0].transport, 'settled');
    assert.equal((h.saved as any).attempts[0].usage.tokens.totalTokenCount, success ? 15 : null);
  }
});
// 수동 요청부터 대기·생성·저장·재시작 복원까지 연결되고 원문이 유지되는지 확인한다.
test('plugin request → waiting → generation → persistence → reload; source stays intact', async () => {
  const h = harness(); const plugin = h.create(); await plugin.onload();
  const original = h.content;
  await plugin.request(); assert.equal(h.saved, null);
  h.advance(59_999); await plugin.tick(); assert.equal(h.saved, null);
  h.advance(1); await plugin.tick(); assert.equal(plugin.frames['test.md'].engine, 'local-test-v1');
  assert.equal(h.content, original);
  const reloaded = h.create(); await reloaded.onload();
  assert.equal(reloaded.frames['test.md'].document.title, '테스트');
  h.failSave(); await reloaded.request();
  assert.match(reloaded.statuses.get('test.md'), /실패/);
  assert.equal(reloaded.frames['test.md'].document.title, '테스트');
});
// 편집 시 대기가 연장되고 플러그인 종료 후에는 처리가 진행되지 않는지 확인한다.
test('editor changes extend an outstanding request; unload prevents processing', async () => {
  const h = harness(); const plugin = h.create(); await plugin.onload(); await plugin.request();
  h.advance(30_000); h.content = '# 수정';
  h.events['editor-change']({ getValue: () => h.content }, { file: h.file });
  h.advance(30_000); await plugin.tick(); assert.equal(h.saved, null);
  h.advance(30_000); await plugin.tick(); assert.equal(plugin.frames['test.md'].document.title, '수정');
  const second = h.create(); await second.onload(); second.onunload();
  h.content = '# unload'; await second.request(); h.advance(60_000); await second.tick();
  assert.equal(second.frames['test.md'].document.title, '수정');
});
// 설정 화면의 키 저장·복원·연결·삭제 흐름과 data.json에 키가 남지 않는지 확인한다.
test('settings UI saves, reloads, checks and deletes key without placing it in data.json', async () => {
  const h = harness(); const plugin = h.create(); await plugin.onload();
  await plugin.request(); h.advance(60_000); await plugin.tick();
  const frame = JSON.stringify(plugin.frames['test.md']);
  h.settingsTab.display();
  const keySetting = h.settings.find(s => s.name === 'Gemini API 키');
  keySetting.text.setValue('dummy-secret');
  await keySetting.buttons.find((b: any) => b.text === '저장').click();
  assert.equal(keySetting.text.getValue(), '');
  assert.equal(plugin.key.read(), 'dummy-secret');
  assert.ok(!JSON.stringify(h.saved).includes('dummy-secret'));
  assert.equal(JSON.stringify(plugin.frames['test.md']), frame);
  const reloaded = h.create(); await reloaded.onload();
  assert.equal(reloaded.key.read(), 'dummy-secret');
  h.settingsTab.display();
  const check = h.settings.find(s => s.name === '연결 확인');
  await check.buttons[0].click();
  assert.equal(h.requests.length, 1);
  assert.ok(!h.requests[0].body.includes(h.content));
  assert.equal(plugin.previews.size, 0);
  await keySetting.buttons.find((b: any) => b.text === '삭제').click();
  assert.equal(reloaded.key.read(), null);
  assert.ok(!JSON.stringify(h.saved).includes('dummy-secret'));
});
// AI 요청의 안정 대기·중복 클릭 처리를 확인하고 미리보기가 영구 Frame을 바꾸지 않는지 확인한다.
test('Gemini request respects stability and duplicate clicks; preview never updates persisted active Frame', async () => {
  const h = harness(); const plugin = h.create(); await plugin.onload();
  plugin.key.save('dummy-secret');
  await plugin.request(); h.advance(60_000); await plugin.tick();
  const saved = JSON.stringify((h.saved as any).frames);
  h.content = '# 새 제목\r\n\r\n새 결정';
  await plugin.request(true); await plugin.request(true);
  h.advance(30_000); h.content += ' 수정';
  h.events['editor-change']({ getValue: () => h.content }, { file: h.file });
  h.advance(59_999); await plugin.tick(); assert.equal(h.requests.length, 0);
  h.advance(1); await plugin.tick(); assert.equal(h.requests.length, 1);
  const preview = plugin.previews.get(h.file.path);
  assert.equal(preview.frame.document.title, '새 제목');
  assert.equal(preview.sourceText, h.content);
  assert.equal(JSON.stringify((h.saved as any).frames), saved);
  plugin.showPreview(h.file.path);
  const elements = (el: any): any[] => [el, ...el.children.flatMap(elements)];
  const shown = elements(h.modals[0].contentEl).map(el => el.text);
  assert.ok(shown.includes('Gemini Frame 검토'));
  assert.ok(shown.includes(h.content));
  assert.ok(shown.some(text => text.includes('재시작하면 사라지며')));
  const before = preview;
  h.respond(async () => ({ status: 403, text: 'dummy-secret' }));
  await plugin.request(true);
  assert.equal(plugin.previews.get(h.file.path), before);
  assert.match(plugin.previewStatuses.get(h.file.path), /403/);
  assert.ok(!plugin.previewStatuses.get(h.file.path).includes('dummy-secret'));
  assert.equal(JSON.stringify((h.saved as any).frames), saved);
  const reloaded = h.create(); await reloaded.onload(); assert.equal(reloaded.previews.size, 0);
  assert.equal(reloaded.frames[h.file.path].document.title, '테스트');
});
// 키가 없으면 호출하지 않고 종료 후 늦게 도착한 미리보기는 버리는지 확인한다.
test('missing key makes no API call; unload discards a late preview response', async () => {
  const h = harness(); const plugin = h.create(); await plugin.onload();
  await plugin.request(true); h.advance(60_000); await plugin.tick();
  assert.equal(h.requests.length, 0);
  plugin.key.save('dummy-secret');
  let finish!: (r: HttpResponse) => void;
  h.respond(() => new Promise(resolve => { finish = resolve; }));
  const pending = plugin.request(true);
  await waitFor(() => h.requests.length === 1);
  assert.equal(h.requests.length, 1);
  plugin.onunload(); finish({ status: 200, text: '{}' }); await pending;
  assert.equal(plugin.previews.size, 0); assert.equal(Object.keys((h.saved as any).frames).length, 0);
  assert.equal((h.saved as any).attempts[0].transport, 'pending');
});
// 구버전은 실제 저장 시 이전하고 미지원 저장 형식에서는 변경을 막는지 확인한다.
test('legacy data loads and migrates only on write; unsupported storage blocks mutation', async () => {
  const h = harness(); const first = h.create(); await first.onload();
  await first.request(); h.advance(60_000); await first.tick();
  h.seed({ version: 1, frames: structuredClone(first.frames) });
  const plugin = h.create(); await plugin.onload();
  assert.equal((h.saved as any).version, 1);
  await plugin.saveSettings(); assert.equal((h.saved as any).version, 3);
  assert.equal(plugin.frames['test.md'].document.title, '테스트');
  h.seed({ version: 999, frames: {} });
  const bad = h.create(); await bad.onload();
  await assert.rejects(bad.saveSettings()); await bad.request();
  assert.equal((h.saved as any).version, 999);
});
// 설정 저장 실패 시 키·Frame을 유지하고 비밀 저장소 미지원 시 키 입력 UI를 막는지 확인한다.
test('settings write failure preserves existing key and Frame; unsupported secret storage disables key controls', async () => {
  const h = harness(); const plugin = h.create(); await plugin.onload();
  plugin.key.save('original-key');
  h.settingsTab.display();
  const key = h.settings.find(s => s.name === 'Gemini API 키');
  key.text.setValue('replacement-key'); h.failSave();
  await key.buttons[0].click();
  assert.equal(plugin.key.read(), 'original-key'); assert.equal(h.saved, null);
  assert.equal(key.text.getValue(), '');
  const other = harness(); const unsupported = other.create();
  unsupported.app.secretStorage = undefined; await unsupported.onload();
  other.settingsTab.display(); assert.ok(!other.settings.some(s => s.name === 'Gemini API 키'));
});

// 재시작 후 미해결 호출을 표시하고 명시적 확인 전 새 요청을 막으며 자동 재전송하지 않는지 확인한다.
test('restarted plugin shows unresolved request, requires explicit risk acknowledgement, and never auto-replays', async () => {
  const h = harness(); const old = h.create(); await old.onload(); old.key.save('key'); h.advance(60_000);
  old.client.timeoutMs = 15;
  let finish!: (value: HttpResponse) => void;
  h.respond(() => new Promise(resolve => { finish = resolve; }));
  await old.request(true); await old.journal.flush();
  assert.match(old.previewStatuses.get('test.md'), /시간/);
  assert.equal(old.connectionState, 'timeout-pending');
  assert.equal(h.requests.length, 1);
  old.onunload();
  const next = h.create(); await next.onload();
  assert.equal(next.journal.needsAcknowledgement, true);
  await next.tick(); assert.equal(h.requests.length, 1);
  await next.request(true); await assert.rejects(next.checkConnection(), /이전 세션/);
  assert.equal(h.requests.length, 1);
  h.settingsTab.display();
  const recovery = h.settings.find(s => s.name === '미해결 요청 확인');
  assert.match(recovery.buttons[0].text, /중복 처리·과금/);
  await recovery.buttons[0].click();
  assert.equal(next.journal.needsAcknowledgement, false); assert.equal(h.requests.length, 1);
  const acknowledged = JSON.stringify(h.saved);
  finish({ status: 200, text: '{}' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.stringify(h.saved), acknowledged);
  h.respond(async request => {
    const blocks = JSON.parse(JSON.parse(request.body).contents[0].parts[0].text).blocks;
    return { status: 200, text: JSON.stringify({ usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 }, modelVersion: 'gemini-3.1-flash-lite', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ domains: [{ path: ['Other'], source: 'unclassified', confidence: 0 }], type: { id: 'idea-note', confidence: 0 }, concepts: [{ concept: 'Reusable concept', confidence: 0.7, evidence: [{ blockIds: blocks.map((b: any) => b.id), labels: [{ id: 'idea', confidence: 0 }] }] }] }) }] } }] }) };
  });
  await next.request(true);
  assert.equal(h.requests.length, 2); assert.equal(next.previews.size, 1);
  assert.equal((h.saved as any).attempts.length, 2);
  assert.equal((h.saved as any).attempts[0].usage.status, 'unknown');
  assert.equal((h.saved as any).attempts[1].usage.tokens.totalTokenCount, 30);
  assert.equal(Object.keys((h.saved as any).frames).length, 0);
  next.showAttempts();
  const text = JSON.stringify(h.modals.at(-1).contentEl);
  assert.match(text, /이전 세션 종료 미확인 1건/);
  assert.match(text, /분류/);
});

// 이전 HTTP가 진행 중이어도 재사용 경로의 새 요청 상태를 이전 작업이 지우지 않는지 확인한다.
test('new file at reused path can request while old HTTP is pending without old result clearing its job', async () => {
  const h = harness(); const plugin = h.create(); await plugin.onload(); plugin.key.save('key'); h.advance(60_000);
  let finish!: (value: HttpResponse) => void;
  h.respond(() => new Promise(resolve => { finish = resolve; }));
  const pending = plugin.request(true); await waitFor(() => h.requests.length === 1);
  h.vaultEvents.delete(h.file);
  const replacement = h.createFile();
  plugin.app.vault.getAbstractFileByPath = () => replacement;
  plugin.app.workspace.getActiveFile = () => replacement;
  h.content = '새 파일'; h.advance(60_000);
  await plugin.request(true);
  assert.equal(plugin.previewQueue.pending('test.md'), true);
  finish({ status: 403, text: '' }); await pending;
  assert.equal(plugin.previewStatuses.has('test.md'), false);
  assert.equal(plugin.previewQueue.pending('test.md'), true);
  h.respond(async () => ({ status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ domains: [{ path: ['Other'], source: 'unclassified', confidence: 0 }], type: { id: 'idea-note', confidence: 0 }, concepts: [{ concept: 'Reusable concept', confidence: 0.7, evidence: [{ blockIds: ['b1'], labels: [{ id: 'idea', confidence: 0 }] }] }] }) }] } }] }) }));
  await plugin.tick();
  assert.equal(plugin.previews.get('test.md').sourceText, '새 파일');
  assert.equal(h.requests.length, 2);
});

// UI 모형의 details 하위는 기본 화면 검사에서 제외하여 개발 정보 노출을 검증한다.
const descendants = (el: any, includeDetails = true): any[] => [el, ...(el.tag === 'details' && !includeDetails ? [] : el.children.flatMap((child: any) => descendants(child, includeDetails)))];
const jsonCopy = (value: unknown) => JSON.parse(JSON.stringify(value));
function domainResponder(domains: unknown[]) {
  return async (request: HttpRequest): Promise<HttpResponse> => {
    const input = JSON.parse(JSON.parse(request.body).contents[0].parts[0].text);
    return { status: 200, text: JSON.stringify({ modelVersion: 'gemini-3.1-flash-lite-001', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ domains, type: { id: 'informational', confidence: 0.83 }, concepts: [{ concept: 'Reusable concept', confidence: 0.7, evidence: [{ blockIds: input.blocks.map((b: any) => b.id), labels: [{ id: 'claim', confidence: 0.72 }, { id: 'evidence', confidence: 0.64 }] }] }] }) }] } }] }) };
  };
}
const economicsCandidate = [{ path: ['Economics'], source: 'new', confidence: 0.91 }];

test('AC-B/C/F/G: structured review approves only the chosen candidate and reuses it after restart', async () => {
  const h = harness(); const plugin = h.create(); await plugin.onload(); plugin.key.save('key'); h.advance(60_000);
  await plugin.request();
  const original = h.content; const frames = JSON.stringify((h.saved as any).frames);
  h.respond(domainResponder([...economicsCandidate, { path: ['Science', 'Biology', 'Genetics'], source: 'new', confidence: 0.9 }]));
  await plugin.request(true);
  const preview = plugin.previews.get(h.file.path);
  assert.deepEqual(jsonCopy(plugin.store.getDomains()), []);
  plugin.showPreview(h.file.path);
  const modal = h.modals.at(-1);
  const visible = descendants(modal.contentEl, false).map(el => el.text).join('\n');
  for (const text of ['Domain', 'Economics', 'Science → Biology → Genetics', '새 Domain 후보', 'Document Type', 'informational', 'Key Concepts', 'Reusable concept', 'Evidence · 1~2행', 'claim · evidence', original]) assert.ok(visible.includes(text), text);
  for (const text of ['confidence', '0.91', '0.83', preview.frame.evaluation.runId, 'gemini-3.1-flash-lite-001', 'concept-extraction-v1', 'schemaVersion']) assert.ok(!visible.includes(text), text);
  const details = descendants(modal.contentEl).find(el => el.tag === 'details');
  assert.equal(details.open, false);
  const developer = descendants(details).map(el => el.text).join('\n');
  for (const text of ['Developer Details', 'confidence', '0.91', preview.frame.evaluation.runId, 'gemini-3.1-flash-lite-001', 'concept-extraction-v1', 'concept-extraction-schema-v1', 'domainCatalogHash']) assert.ok(developer.includes(text), text);
  const approve = descendants(modal.contentEl).find(el => el.text === '승인');
  approve.onclick();
  await waitFor(() => plugin.store.getDomains().length === 1);
  assert.deepEqual(jsonCopy(plugin.store.getDomains()), [{ path: ['Economics'] }]);
  assert.equal(preview.frame.document.domains[0].source, 'new', 'approval must not rewrite AI provenance');
  assert.equal(JSON.stringify((h.saved as any).frames), frames); assert.equal(h.content, original);
  plugin.onunload();
  const next = h.create(); await next.onload();
  assert.equal(next.previews.size, 0);
  h.respond(domainResponder([{ path: ['Economics'], source: 'existing', confidence: 0.91 }]));
  await next.request(true);
  const sent = JSON.parse(JSON.parse(h.requests.at(-1)!.body).contents[0].parts[0].text);
  assert.deepEqual(sent.existingDomains, [{ path: ['Economics'] }]);
  assert.equal(next.previews.get(h.file.path).frame.document.domains[0].source, 'existing');
  next.showPreview(h.file.path);
  assert.ok(descendants(h.modals.at(-1).contentEl, false).some(el => el.text === '기존 Domain 재사용'));
  assert.equal(JSON.stringify((h.saved as any).frames), frames);
});

test('AC-D: rejection or no approval never enters subsequent requests or persisted Catalog', async () => {
  for (const reject of [false, true]) {
    const h = harness(); const plugin = h.create(); await plugin.onload(); plugin.key.save('key'); h.advance(60_000);
    h.respond(domainResponder(economicsCandidate)); await plugin.request(true);
    const preview = plugin.previews.get(h.file.path);
    if (reject) {
      plugin.showPreview(h.file.path);
      descendants(h.modals.at(-1).contentEl).find(el => el.text === '거절').onclick();
      await waitFor(() => Object.values(preview.domainReviews).includes('rejected'));
      await assert.rejects(plugin.reviewDomain(preview, 0, true));
    }
    await plugin.request(true);
    const sent = JSON.parse(JSON.parse(h.requests.at(-1)!.body).contents[0].parts[0].text);
    assert.deepEqual(sent.existingDomains, []); assert.deepEqual((h.saved as any).domains, []);
    assert.equal(h.requests.length, 2, 'review must not make an extra model call');
  }
});

test('approval failure stays unapproved, shows retry, and successful retry persists once', async () => {
  const h = harness(); const plugin = h.create(); await plugin.onload(); plugin.key.save('key'); h.advance(60_000);
  h.respond(domainResponder(economicsCandidate)); await plugin.request(true); plugin.showPreview(h.file.path);
  const modal = h.modals.at(-1); h.failSave();
  descendants(modal.contentEl).find(el => el.text === '승인').onclick();
  await waitFor(() => descendants(modal.contentEl).some(el => el.text.includes('완료하지 못했습니다')));
  assert.deepEqual(jsonCopy(plugin.store.getDomains()), []);
  assert.deepEqual(jsonCopy(plugin.previews.get(h.file.path).domainReviews), {});
  h.recoverSave(); descendants(modal.contentEl).find(el => el.text === '승인').onclick();
  await waitFor(() => plugin.store.getDomains().length === 1);
  assert.deepEqual((h.saved as any).domains, [{ path: ['Economics'] }]);
  assert.equal(h.requests.length, 1);
});

test('stale preview approval is blocked after replacement, deletion, rename or unload', async () => {
  for (const action of ['replace', 'delete', 'rename', 'unload']) {
    const h = harness(); const plugin = h.create(); await plugin.onload(); plugin.key.save('key'); h.advance(60_000);
    h.respond(domainResponder(economicsCandidate)); await plugin.request(true);
    const preview = plugin.previews.get(h.file.path);
    if (action === 'replace') await plugin.request(true);
    if (action === 'delete') h.vaultEvents.delete(h.file);
    if (action === 'rename') { const old = h.file.path; h.file.path = 'new.md'; h.vaultEvents.rename(h.file, old); }
    if (action === 'unload') plugin.onunload();
    await assert.rejects(plugin.reviewDomain(preview, 0, true));
    assert.deepEqual(jsonCopy(plugin.store.getDomains()), []);
  }
});

test('invented existing domain cannot replace a valid preview and does not register a candidate', async () => {
  const h = harness(); const plugin = h.create(); await plugin.onload(); plugin.key.save('key'); h.advance(60_000);
  h.respond(domainResponder(economicsCandidate)); await plugin.request(true);
  const before = plugin.previews.get(h.file.path);
  h.respond(domainResponder([{ path: ['Behavioral Economics'], source: 'existing', confidence: 0.9 }]));
  await plugin.request(true);
  assert.equal(plugin.previews.get(h.file.path), before);
  assert.match(plugin.previewStatuses.get(h.file.path), /검증 실패/);
  assert.deepEqual(jsonCopy(plugin.store.getDomains()), []);
});

test('duplicate review clicks cannot race approval with rejection or duplicate Catalog entries', async () => {
  const h = harness(); const plugin = h.create(); await plugin.onload(); plugin.key.save('key'); h.advance(60_000);
  h.respond(domainResponder(economicsCandidate)); await plugin.request(true);
  const preview = plugin.previews.get(h.file.path);
  const saving = plugin.reviewDomain(preview, 0, true);
  await assert.rejects(plugin.reviewDomain(preview, 0, false));
  await saving;
  await assert.rejects(plugin.reviewDomain(preview, 0, true));
  assert.deepEqual((h.saved as any).domains, [{ path: ['Economics'] }]);
});

// 사용자 Highlight는 모델 값이 아니라 현재 미리보기에서만 변경하는 명시적 조작이다.
test('Concept review toggles highlight while preserving source and stored legacy Frame', async () => {
  const h = harness(); const plugin = h.create(); await plugin.onload(); plugin.key.save('key'); h.advance(60_000);
  await plugin.request(); const before = JSON.stringify((h.saved as any).frames);
  h.respond(domainResponder(economicsCandidate)); await plugin.request(true); plugin.showPreview(h.file.path);
  const preview = plugin.previews.get(h.file.path); const modal = h.modals.at(-1);
  const beforeSource = h.content;
  descendants(modal.contentEl).find(el => el.text === '중요 표시').onclick();
  assert.equal(preview.frame.concepts[0].highlight, true);
  plugin.showPreview(h.file.path);
  assert.ok(descendants(h.modals.at(-1).contentEl).some(el => el.text === '중요 표시 해제'));
  descendants(modal.contentEl).find(el => el.text === '중요 표시 해제').onclick();
  assert.equal(preview.frame.concepts[0].highlight, false);
  assert.equal(h.content, beforeSource); assert.equal(JSON.stringify((h.saved as any).frames), before);
});

test('partial long-document failure keeps previous preview and its human highlight', async () => {
  const h = harness(); const plugin = h.create(); await plugin.onload(); plugin.key.save('key'); h.advance(60_000);
  h.respond(domainResponder(economicsCandidate)); await plugin.request(true);
  const before = plugin.previews.get(h.file.path); before.frame.concepts[0].highlight = true;
  h.content = `# First\n\n${'원문 '.repeat(1000)}\n\n# Second\n\n${'다음 '.repeat(1000)}`;
  let calls = 0;
  h.respond(async () => {
    if (++calls === 2) return { status: 403, text: '{}' };
    return { status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ domains: economicsCandidate, type: { id: 'informational', confidence: 0.8 }, concepts: [] }) }] } }] }) };
  });
  await plugin.request(true); h.advance(60_000); await plugin.tick();
  assert.equal(calls, 2); assert.equal(plugin.previews.get(h.file.path), before);
  assert.equal(before.frame.concepts[0].highlight, true);
  assert.match(plugin.previewStatuses.get(h.file.path), /403/);
});

test('zero Concept review explicitly reports no extracted knowledge without hiding original document', async () => {
  const h = harness(); const plugin = h.create(); await plugin.onload(); plugin.key.save('key'); h.advance(60_000);
  const original = h.content;
  h.respond(async () => ({ status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ domains: [{ path: ['Other'], source: 'unclassified', confidence: 0 }], type: { id: 'unclassified', confidence: 0 }, concepts: [] }) }] } }] }) }));
  await plugin.request(true); plugin.showPreview(h.file.path);
  const visible = descendants(h.modals.at(-1).contentEl, false).map(el => el.text).join('\n');
  assert.match(visible, /핵심 개념을 찾지 못했습니다/); assert.equal(h.content, original);
  assert.equal(plugin.previews.get(h.file.path).frame.concepts.length, 0);
});
