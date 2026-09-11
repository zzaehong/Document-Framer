import { ItemView, MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { Frame, ManualQueue, TestEngine } from './core';
const VIEW = 'document-framer-view';
interface Saved { version: 1; frames: Record<string, Frame> }
export default class DocumentFramer extends Plugin {
  queue = new ManualQueue();
  frames: Record<string, Frame> = Object.create(null);
  statuses = new Map<string, string>();
  private engine = new TestEngine();
  private stopped = false;
  private ticking = false;
  private storageError = false;
  async onload() {
    try {
      const data: Saved | null = await this.loadData();
      if (data && (data.version !== 1 || !data.frames || typeof data.frames !== 'object' || Array.isArray(data.frames))) throw new Error('Unsupported storage');
      if (data) this.frames = Object.assign(Object.create(null), data.frames);
    } catch { this.storageError = true; new Notice('Frame 저장소를 읽지 못했습니다. data.json을 확인하고 플러그인을 다시 켜세요.'); }
    this.registerView(VIEW, leaf => new FrameView(leaf, this));
    this.addRibbonIcon('scan-text', '현재 문서 Framing', () => { void this.request(); });
    this.addCommand({ id: 'frame-current-document', name: '현재 문서 Framing 요청', callback: () => { void this.request(); } });
    this.addCommand({ id: 'inspect-frame', name: 'Frame 보기', callback: () => { void this.openPanel(); } });
    this.registerEvent(this.app.workspace.on('file-open', () => this.refresh()));
    this.registerEvent(this.app.workspace.on('editor-change', (editor, info) => {
      if (info.file) this.observe(info.file, editor.getValue());
    }));
    this.registerEvent(this.app.vault.on('modify', file => {
      if (file instanceof TFile && file.extension === 'md') void this.read(file).then(text => this.observe(file, text)).catch(() => this.fail(file.path, '원문을 읽지 못했습니다. 다시 요청하세요.'));
    }));
    this.registerEvent(this.app.vault.on('delete', file => { this.queue.remove(file.path); this.refresh(); }));
    this.registerEvent(this.app.vault.on('rename', (_file, oldPath) => { this.queue.remove(oldPath); this.refresh(); }));
    this.registerInterval(window.setInterval(() => { void this.tick(); }, 250));
  }
  onunload() { this.stopped = true; }
  private observe(file: TFile, text: string) {
    this.queue.observe(file.path, text, file.stat.mtime, Date.now());
    this.refresh();
  }
  private async read(file: TFile) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.file === file ? view.editor.getValue() : this.app.vault.read(file);
  }
  async request() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') { new Notice('Markdown 문서를 먼저 열어주세요.'); return; }
    if (this.storageError) { new Notice('저장소 오류를 해결한 후 플러그인을 다시 켜세요.'); return; }
    try {
      this.observe(file, await this.read(file));
      this.queue.request(file.path);
      this.statuses.delete(file.path);
      await this.openPanel();
      await this.tick();
    } catch { this.fail(file.path, '원문 읽기 또는 패널 열기에 실패했습니다. 다시 요청하세요.'); }
  }
  private async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      for (const path of this.queue.takeReady(Date.now())) {
        try {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (!(file instanceof TFile)) throw new Error('문서가 삭제되거나 이동되었습니다. 다시 요청하세요.');
          const text = await this.read(file);
          this.observe(file, text);
          if (this.queue.remaining(path, Date.now()) > 0) {
            this.queue.finish(path); this.queue.request(path); continue;
          }
          this.statuses.set(path, '테스트 Frame 생성 중…'); this.refresh();
          const frame = this.engine.generate({ path, basename: file.basename, ctime: file.stat.ctime, mtime: file.stat.mtime, text });
          if (this.stopped) break;
          const next = Object.assign(Object.create(null), this.frames, { [path]: frame });
          await this.saveData({ version: 1, frames: next });
          this.frames = next;
          this.statuses.set(path, '테스트 Frame 저장 완료');
        } catch (error) {
          this.fail(path, error instanceof Error ? `처리 실패: ${error.message} 다시 요청할 수 있습니다.` : '저장에 실패했습니다. 다시 요청하세요.');
        } finally { this.queue.finish(path); }
      }
    } finally { this.ticking = false; this.refresh(); }
  }
  private fail(path: string, message: string) { this.statuses.set(path, message); this.refresh(); }
  refresh() { if (!this.stopped) this.app.workspace.getLeavesOfType(VIEW).forEach(leaf => (leaf.view as FrameView).render()); }
  async openPanel() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { const right = this.app.workspace.getRightLeaf(false); if (!right) return; leaf = right; await leaf.setViewState({ type: VIEW, active: true }); }
    void this.app.workspace.revealLeaf(leaf);
    this.refresh();
  }
}
class FrameView extends ItemView {
  private signature = '';
  constructor(leaf: WorkspaceLeaf, private plugin: DocumentFramer) { super(leaf); }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Document Framer'; }
  getIcon() { return 'scan-text'; }
  async onOpen() { this.render(); }
  render() {
    const file = this.app.workspace.getActiveFile();
    const path = file?.extension === 'md' ? file.path : null;
    const frame = path ? this.plugin.frames[path] : undefined;
    const state = path && this.plugin.queue.pending(path)
      ? `안정 대기 중 · ${Math.ceil(this.plugin.queue.remaining(path, Date.now()) / 1000)}초 남음`
      : path ? this.plugin.statuses.get(path) ?? '수동 요청 대기' : 'Markdown 문서를 열어주세요.';
    const signature = JSON.stringify([path, state, frame]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.contentEl.empty(); this.contentEl.addClass('document-framer');
    this.contentEl.createEl('h2', { text: 'Document Framer' });
    this.contentEl.createEl('p', { text: '1단계 · 로컬 테스트 엔진 (AI 분류 아님)' });
    this.contentEl.createEl('p', { text: path ?? '선택된 문서 없음', cls: 'df-path' });
    const button = this.contentEl.createEl('button', { text: '현재 문서 Framing', cls: 'mod-cta' });
    button.disabled = !path;
    button.onclick = () => { void this.plugin.request(); };
    this.contentEl.createEl('p', { text: state, attr: { role: 'status' } });
    this.contentEl.createEl('p', { text: '마지막 원문 변경 후 60초가 지나면 요청을 실행합니다.' });
    if (frame) {
      this.contentEl.createEl('h3', { text: '저장된 테스트 결과' });
      this.contentEl.createEl('p', { text: '요청 당시 결과입니다. 수정한 문서는 다시 Framing을 요청하세요.' });
      this.contentEl.createEl('pre').createEl('code', { text: JSON.stringify(frame, null, 2) });
    } else this.contentEl.createEl('p', { text: '저장된 Frame이 없습니다.' });
  }
}
