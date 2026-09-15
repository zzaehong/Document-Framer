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
      domains: [{ id: 'other', confidence: 0.3 }], type: { id: 'idea-note', confidence: 0.6 },
      units: input.blocks.map((b: any) => ({ blockIds: [b.id], labels: [{ id: 'idea', confidence: 0.5 }] })),
    }) }] } }] }) };
  };
  class Element {
    text = ''; children: Element[] = [];
    empty() { this.children = []; } addClass() {}
    createEl(_tag: string, options?: { text?: string }) { const el = new Element(); el.text = options?.text ?? ''; this.children.push(el); return el; }
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
  const context = { module: { exports: {} as any }, require: () => ({ Plugin, TFile, ItemView: class {}, Modal, MarkdownView: class {}, Notice: class {}, Setting,
    PluginSettingTab: class { containerEl = new Element(); },
    requestUrl: async (request: HttpRequest) => { requests.push(request); return responder(request); },
  }), window: { setInterval: () => 1 }, TextEncoder, crypto: webcrypto, structuredClone, setTimeout, clearTimeout, Date: class extends Date { static now() { return now; } } };
  vm.runInNewContext(code, context);
  const create = () => new context.module.exports.default();
  return { create, file, createFile: () => new TFile(), events, vaultEvents, secrets, requests, settings, modals, get settingsTab() { return settingsTab; },
    respond(fn: typeof responder) { responder = fn; }, seed(value: unknown) { saved = value; },
    get content() { return content; }, set content(value: string) { content = value; }, advance(ms: number) { now += ms; }, failSave() { failSave = true; }, get saved() { return saved; } };
}
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
    finish(success ? { status: 200, text: JSON.stringify({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }, candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ domains: [{ id: 'other', confidence: 0 }], type: { id: 'idea-note', confidence: 0 }, units: [{ blockIds: ['b1', 'b2'], labels: [{ id: 'idea', confidence: 0 }] }] }) }] } }] }) } : { status: 403, text: '' });
    await pending;
    assert.equal(plugin.previews.has('test.md'), false, change);
    assert.equal(plugin.previewStatuses.has('test.md'), false, change);
    assert.equal((h.saved as any).attempts.length, 1);
    assert.equal((h.saved as any).attempts[0].transport, 'settled');
    assert.equal((h.saved as any).attempts[0].usage.tokens.totalTokenCount, success ? 15 : null);
  }
});
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
  assert.ok(shown.includes('Gemini Frame 미리보기'));
  assert.ok(shown.includes('# 새 제목\r\n'));
  assert.ok(shown.some(text => text.includes('재시작하면 사라집니다')));
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
test('legacy data loads and migrates only on write; unsupported storage blocks mutation', async () => {
  const h = harness(); const first = h.create(); await first.onload();
  await first.request(); h.advance(60_000); await first.tick();
  h.seed({ version: 1, frames: structuredClone(first.frames) });
  const plugin = h.create(); await plugin.onload();
  assert.equal((h.saved as any).version, 1);
  await plugin.saveSettings(); assert.equal((h.saved as any).version, 2);
  assert.equal(plugin.frames['test.md'].document.title, '테스트');
  h.seed({ version: 999, frames: {} });
  const bad = h.create(); await bad.onload();
  await assert.rejects(bad.saveSettings()); await bad.request();
  assert.equal((h.saved as any).version, 999);
});
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
    return { status: 200, text: JSON.stringify({ usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 }, modelVersion: 'gemini-3.1-flash-lite', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ domains: [{ id: 'other', confidence: 0 }], type: { id: 'idea-note', confidence: 0 }, units: [{ blockIds: blocks.map((b: any) => b.id), labels: [{ id: 'idea', confidence: 0 }] }] }) }] } }] }) };
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
  h.respond(async () => ({ status: 200, text: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ domains: [{ id: 'other', confidence: 0 }], type: { id: 'idea-note', confidence: 0 }, units: [{ blockIds: ['b1'], labels: [{ id: 'idea', confidence: 0 }] }] }) }] } }] }) }));
  await plugin.tick();
  assert.equal(plugin.previews.get('test.md').sourceText, '새 파일');
  assert.equal(h.requests.length, 2);
});
