import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import vm from 'node:vm';

const code = buildSync({ entryPoints: ['src/main.ts'], bundle: true, external: ['obsidian'], format: 'cjs', write: false }).outputFiles[0].text;
function harness() {
  let now = 100_000;
  let saved: unknown = null;
  let failSave = false;
  const events: Record<string, (...args: any[]) => void> = {};
  class TFile { path = 'test.md'; basename = 'test'; extension = 'md'; stat = { ctime: 0, mtime: now }; }
  const file = new TFile();
  let content = '# 테스트\n원문';
  class Plugin {
    app = {
      workspace: { getActiveFile: () => file, getActiveViewOfType: () => ({ file, editor: { getValue: () => content } }), getLeavesOfType: () => [], getRightLeaf: () => null, on: (name: string, fn: (...args: any[]) => void) => { events[name] = fn; } },
      vault: { on: () => {}, getAbstractFileByPath: () => file, read: async () => content },
    };
    loadData = async () => saved;
    saveData = async (value: unknown) => { if (failSave) throw new Error('disk full'); saved = structuredClone(value); };
    registerView() {} addRibbonIcon() {} addCommand() {} registerEvent() {} registerInterval() {}
  }
  const context = { module: { exports: {} as any }, require: () => ({ Plugin, TFile, ItemView: class {}, MarkdownView: class {}, Notice: class {} }), window: { setInterval: () => 1 }, TextEncoder, Date: class extends Date { static now() { return now; } } };
  vm.runInNewContext(code, context);
  const create = () => new context.module.exports.default();
  return { create, file, events, get content() { return content; }, set content(value: string) { content = value; }, advance(ms: number) { now += ms; }, failSave() { failSave = true; }, get saved() { return saved; } };
}
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
