/**
 * 플러그인의 진입점이자 연결 담당: Obsidian 이벤트, 처리 큐, 엔진, 저장소와 화면을 연결한다.
 * 읽는 순서: onload() 등록 → request() 수동 요청 → tick() 대기 확인 및 처리 → 패널/모달 표시.
 * 로컬 결과는 FrameStore에 저장하고, Gemini 결과는 previews 메모리에만 보관한다.
 */
import { ItemView, MarkdownView, Modal, Notice, Plugin, requestUrl, TFile, WorkspaceLeaf } from 'obsidian';
import { Frame, ManualQueue, TestEngine } from './core';
import { FrameStore, GeminiKey } from './storage';
import { FramerSettingsTab } from './settings';
import { GeminiClient, GeminiError } from './gemini';
import { GeminiFramer, Preview } from './framing';
import { AttemptJournal, attemptSummary } from './attempts';
const VIEW = 'document-framer-view';
// 비동기 작업이 시작한 파일 객체와 경로 세대를 기억한다. 같은 경로에 새 파일이 생겨도 구별한다.
interface SourceTicket { path: string; file: TFile; generation: number }
export default class DocumentFramer extends Plugin {
  // 로컬 생성과 AI 미리보기는 요청·대기 상태를 각각 관리한다.
  queue = new ManualQueue();
  previewQueue = new ManualQueue();
  previews = new Map<string, Preview>();
  previewStatuses = new Map<string, string>();
  private generations = new Map<string, number>();
  store = new FrameStore(data => this.saveData(data));
  journal = new AttemptJournal(attempts => {
    if (this.storageError) throw new Error('저장소 오류');
    return this.store.saveAttempts(attempts);
  }, () => this.refresh());
  private client = new GeminiClient(request => requestUrl(request), undefined, undefined, this.journal);
  private framer = new GeminiFramer(this.client);
  get connectionState() { return this.client.status; }
  get frames(): Record<string, Frame> { return this.store.state.frames; }
  get key() { return new GeminiKey(this.app.secretStorage); }
  statuses = new Map<string, string>();
  private engine = new TestEngine();
  private stopped = false;
  private ticking = false;
  private storageError = false;
  // 저장 상태를 복원한 뒤 명령·화면·파일 이벤트와 주기적 큐 검사를 등록한다.
  async onload() {
    try {
      this.store.load(await this.loadData());
      this.journal.load(this.store.state.attempts);
    } catch { this.storageError = true; new Notice('Frame 저장소를 읽지 못했습니다. data.json을 확인하고 플러그인을 다시 켜세요.'); }
    this.addSettingTab(new FramerSettingsTab(this.app, this));
    this.registerView(VIEW, leaf => new FrameView(leaf, this));
    this.addRibbonIcon('scan-text', '현재 문서 Framing', () => { void this.request(); });
    this.addCommand({ id: 'frame-current-document', name: '현재 문서 Framing 요청', callback: () => { void this.request(); } });
    this.addCommand({ id: 'inspect-frame', name: 'Frame 보기', callback: () => { void this.openPanel(); } });
    this.addCommand({ id: 'preview-gemini-frame', name: 'Gemini Framing 미리보기 요청', callback: () => { void this.request(true); } });
    this.addCommand({ id: 'inspect-gemini-attempts', name: 'Gemini 호출 기록·복구 보기', callback: () => this.showAttempts() });
    this.registerEvent(this.app.workspace.on('file-open', () => this.refresh()));
    // 편집 중인 미저장 내용도 관찰하여 안정 대기 시간을 다시 계산한다.
    this.registerEvent(this.app.workspace.on('editor-change', (editor, info) => {
      if (info.file) this.observe(info.file, editor.getValue());
    }));
    this.registerEvent(this.app.vault.on('modify', file => {
      if (file instanceof TFile && file.extension === 'md') void this.read(file).then(text => this.observe(file, text)).catch(() => this.fail(file.path, '원문을 읽지 못했습니다. 다시 요청하세요.'));
    }));
    this.registerEvent(this.app.vault.on('delete', file => this.invalidate(file.path)));
    this.registerEvent(this.app.vault.on('rename', (_file, oldPath) => this.invalidate(oldPath)));
    this.registerInterval(window.setInterval(() => { void this.tick(); }, 250));
  }
  // 종료 후 후속 처리를 막는다. 진행 중인 원격 HTTP 요청 자체를 취소하는 것은 아니다.
  onunload() { this.stopped = true; this.client.close(); this.journal.close(); this.previews.clear(); }
  private observe(file: TFile, text: string) {
    if (!this.generations.has(file.path)) this.generations.set(file.path, 0);
    this.queue.observe(file.path, text, file.stat.mtime, Date.now());
    this.previewQueue.observe(file.path, text, file.stat.mtime, Date.now());
    this.refresh();
  }
  private ticket(file: TFile): SourceTicket {
    if (!this.generations.has(file.path)) this.generations.set(file.path, 0);
    return { path: file.path, file, generation: this.generations.get(file.path)! };
  }
  // 경로 세대와 파일 객체가 모두 일치해야 이전 비동기 작업의 결과를 사용할 수 있다.
  private valid(ticket: SourceTicket) {
    return !this.stopped && this.generations.get(ticket.path) === ticket.generation
      && ticket.file.path === ticket.path && this.app.vault.getAbstractFileByPath(ticket.path) === ticket.file;
  }
  private invalidate(path: string) {
    // 폴더 이동/삭제와 같은 경로의 새 파일도 이전 요청을 되살릴 수 없다.
    for (const known of this.generations.keys()) if (known === path || known.startsWith(`${path}/`)) {
      this.generations.set(known, this.generations.get(known)! + 1);
      this.queue.remove(known); this.previewQueue.remove(known);
      this.previews.delete(known); this.previewStatuses.delete(known); this.statuses.delete(known);
    }
    this.refresh();
  }
  // 현재 편집 문서는 디스크보다 편집기 내용을 우선하여 미저장 변경까지 읽는다.
  private async read(file: TFile) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.file === file ? view.editor.getValue() : this.app.vault.read(file);
  }
  // 실행 의사를 큐에 표시하는 진입점. 문서 관찰만으로는 작업이 요청되지 않는다.
  async request(preview = false) {
    if (this.stopped) return;
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') { new Notice('Markdown 문서를 먼저 열어주세요.'); return; }
    if (this.storageError) { new Notice('저장소 오류를 해결한 후 플러그인을 다시 켜세요.'); return; }
    const ticket = this.ticket(file);
    try {
      if (preview) { try { this.ensureGeminiReady(); } catch (error) { new Notice((error as Error).message); return; } }
      if (preview && !this.key.read()) { new Notice('설정에서 Gemini API 키를 저장하세요.'); return; }
      const text = await this.read(file);
      if (!this.valid(ticket)) return;
      this.observe(file, text);
      (preview ? this.previewQueue : this.queue).request(file.path);
      (preview ? this.previewStatuses : this.statuses).delete(file.path);
      await this.openPanel();
      await this.tick();
    } catch { if (this.valid(ticket)) this.fail(file.path, '원문 읽기 또는 패널 열기에 실패했습니다. 다시 요청하세요.'); }
  }
  // 250ms마다 호출되지만 앞선 tick이 끝나기 전에는 재진입하지 않는다.
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
          // 실행 직전 다시 읽은 내용이 바뀌었다면 요청을 되돌려 60초 대기를 이어간다.
          if (this.queue.remaining(path, Date.now()) > 0) {
            this.queue.finish(path); this.queue.request(path); continue;
          }
          this.statuses.set(path, '테스트 Frame 생성 중…'); this.refresh();
          const frame = this.engine.generate({ path, basename: file.basename, ctime: file.stat.ctime, mtime: file.stat.mtime, text });
          if (this.stopped) break;
          await this.store.saveFrame(path, frame);
          this.statuses.set(path, '테스트 Frame 저장 완료');
        } catch (error) {
          this.fail(path, error instanceof Error ? `처리 실패: ${error.message} 다시 요청할 수 있습니다.` : '저장에 실패했습니다. 다시 요청하세요.');
        } finally { this.queue.finish(path); }
      }
      // AI 처리 후보의 파일 신원을 미리 캡처하여 앞선 요청을 기다리는 동안의 삭제·이동도 감지한다.
      const ready = this.previewQueue.takeReady(Date.now()).map(path => {
        const file = this.app.vault.getAbstractFileByPath(path);
        return { path, ticket: file instanceof TFile ? this.ticket(file) : null };
      });
      for (const { path, ticket } of ready) {
        try {
          if (!ticket || !this.valid(ticket)) continue;
          const file = ticket.file;
          const text = await this.read(file);
          if (!this.valid(ticket)) continue;
          this.observe(file, text);
          if (this.previewQueue.remaining(path, Date.now()) > 0) {
            this.previewQueue.finish(path); this.previewQueue.request(path); continue;
          }
          this.previewStatuses.set(path, 'Gemini 분류 중…'); this.refresh();
          this.ensureGeminiReady();
          const preview = await this.framer.generate({ path, basename: file.basename, ctime: file.stat.ctime, mtime: file.stat.mtime, text }, this.key.read() ?? '', 'classification', () => this.valid(ticket));
          if (!this.valid(ticket)) continue;
          // 검증된 결과만 메모리에 게시한다. 저장된 로컬 Frame은 이 경로에서 갱신하지 않는다.
          this.previews.set(path, preview);
          this.previewStatuses.set(path, '미리보기 생성 완료 · 요청 당시 원문 기준');
        } catch (error) {
          if (ticket && this.valid(ticket)) this.previewStatuses.set(path, error instanceof Error ? error.message : '미리보기 생성 실패. 다시 요청하세요.');
        } finally { if (ticket && this.valid(ticket)) this.previewQueue.finish(path); }
      }
    } finally { this.ticking = false; this.refresh(); }
  }
  private fail(path: string, message: string) { this.statuses.set(path, message); this.refresh(); }
  async saveSettings() {
    if (this.storageError) throw new Error('저장소 오류를 해결한 후 플러그인을 다시 켜세요.');
    await this.store.saveSettings();
  }
  async checkConnection() {
    try { this.ensureGeminiReady(); await this.framer.checkConnection(this.key.read() ?? ''); }
    catch (error) {
      if (error instanceof GeminiError) throw error;
      throw new Error('연결 응답 검증 또는 비밀 저장소 확인에 실패했습니다.');
    }
  }
  // 저장소 오류나 이전 세션 미해결 호출이 있으면 새로운 전송을 시작하지 않는다.
  private ensureGeminiReady() {
    if (this.stopped) throw new GeminiError('플러그인이 종료되었습니다.');
    if (this.storageError) throw new GeminiError('저장소 오류를 해결한 후 플러그인을 다시 켜세요.');
    if (this.journal.needsAcknowledgement) throw new GeminiError('이전 세션의 HTTP 종료 미확인 기록이 있습니다. 설정에서 중복 처리·과금 가능성을 확인한 뒤 새 요청을 선택하세요.');
  }
  async acknowledgeUnresolved() {
    if (this.client.status !== 'idle') throw new Error('현재 세션의 HTTP가 끝난 뒤 다시 확인하세요.');
    await this.journal.acknowledgeUnresolved();
  }
  showAttempts() { new AttemptModal(this.app, this).open(); }
  showPreview(path: string) {
    const preview = this.previews.get(path);
    if (preview) new PreviewModal(this.app, preview).open();
  }
  refresh() { if (!this.stopped) this.app.workspace.getLeavesOfType(VIEW).forEach(leaf => (leaf.view as FrameView).render()); }
  // 이미 열린 패널을 재사용하고, 없으면 오른쪽 영역에 생성한다.
  async openPanel() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { const right = this.app.workspace.getRightLeaf(false); if (!right) return; leaf = right; await leaf.setViewState({ type: VIEW, active: true }); }
    void this.app.workspace.revealLeaf(leaf);
    this.refresh();
  }
}
// 현재 문서의 대기 상태, 저장된 로컬 결과와 Gemini 미리보기 진입 버튼을 표시한다.
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
    const preview = path ? this.plugin.previews.get(path) : undefined;
    const previewState = path && this.plugin.previewQueue.pending(path)
      ? `Gemini 안정 대기 중 · ${Math.ceil(this.plugin.previewQueue.remaining(path, Date.now()) / 1000)}초 남음`
      : path ? this.plugin.previewStatuses.get(path) ?? 'Gemini 미리보기 요청 대기' : '';
    const state = path && this.plugin.queue.pending(path)
      ? `안정 대기 중 · ${Math.ceil(this.plugin.queue.remaining(path, Date.now()) / 1000)}초 남음`
      : path ? this.plugin.statuses.get(path) ?? '수동 요청 대기' : 'Markdown 문서를 열어주세요.';
    // 주기적으로 refresh되어도 표시할 값이 같으면 DOM을 다시 만들지 않는다.
    const signature = JSON.stringify([path, state, frame, previewState, preview?.frame.generatedAt, this.plugin.connectionState, this.plugin.journal.persistenceError, this.plugin.journal.needsAcknowledgement]);
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
    this.contentEl.createEl('h3', { text: '2단계 · Gemini 미리보기' });
    this.contentEl.createEl('p', { text: '요청 시 현재 문서 텍스트를 Google Gemini로 전송합니다. API 이용 요금이 발생할 수 있습니다. 결과는 별도 미리보기로만 표시됩니다.' });
    this.contentEl.createEl('p', { text: '무상 API의 입력·출력은 제품 개선과 사람 검토에 이용될 수 있습니다. 비민감 문서로 평가하고 적용 조건·지역 예외는 설정의 공식 정책 안내를 확인하세요.' });
    const generate = this.contentEl.createEl('button', { text: 'Gemini 미리보기 요청' });
    generate.disabled = !path;
    generate.onclick = () => { void this.plugin.request(true); };
    this.contentEl.createEl('p', { text: previewState, attr: { role: 'status' } });
    if (this.plugin.journal.persistenceError) this.contentEl.createEl('p', { text: '호출 기록 저장 실패: 일부 최신 기록은 메모리에만 있습니다. 저장소를 확인하세요.' });
    if (this.plugin.connectionState === 'timeout-pending') this.contentEl.createEl('p', { text: '시간 초과 · HTTP 종료 미확인. 로컬 대기 종료는 원격 취소가 아닙니다.' });
    if (this.plugin.journal.needsAcknowledgement) this.contentEl.createEl('p', { text: '이전 세션의 미해결 요청이 있습니다. 설정에서 복구 안내를 확인하세요.' });
    const attempts = this.contentEl.createEl('button', { text: 'Gemini 호출 기록·복구 보기' });
    attempts.onclick = () => this.plugin.showAttempts();
    if (preview && path) {
      const inspect = this.contentEl.createEl('button', { text: '최근 Gemini 미리보기 열기' });
      inspect.onclick = () => this.plugin.showPreview(path);
    }
    if (frame) {
      this.contentEl.createEl('h3', { text: '저장된 테스트 결과' });
      this.contentEl.createEl('p', { text: '요청 당시 결과입니다. 수정한 문서는 다시 Framing을 요청하세요.' });
      this.contentEl.createEl('pre').createEl('code', { text: JSON.stringify(frame, null, 2) });
    } else this.contentEl.createEl('p', { text: '저장된 Frame이 없습니다.' });
  }
}

// 요청 당시 원문 스냅샷에서 지식 단위별 범위를 잘라 보여주는 읽기 전용 창이다.
class PreviewModal extends Modal {
  constructor(app: DocumentFramer['app'], private preview: Preview) { super(app); }
  onOpen() {
    this.contentEl.addClass('document-framer');
    const { frame, sourceText } = this.preview;
    this.contentEl.createEl('h2', { text: 'Gemini Frame 미리보기' });
    this.contentEl.createEl('p', { text: `${frame.document.path} · ${frame.generatedAt}` });
    this.contentEl.createEl('p', { text: `실행 ID: ${frame.evaluation.runId} · 응답 모델: ${frame.modelVersion ?? '미확인'}` });
    this.contentEl.createEl('p', { text: '요청 당시 원문 위치입니다. 현재 편집 내용과 다를 수 있습니다. taxonomy는 초안이며 confidence는 모델의 자기 평가입니다. 활성 Frame에 반영되지 않고 재시작하면 사라집니다.' });
    this.contentEl.createEl('p', { text: `Domain: ${frame.document.domains.map(d => `${d.path.join(' → ')} (${d.confidence})`).join(', ')} · Type: ${frame.document.type.id} (${frame.document.type.confidence})` });
    for (const unit of frame.knowledgeUnits) {
      this.contentEl.createEl('h3', { text: `${unit.id} · ${unit.source.startLine}~${unit.source.endLine}행` });
      this.contentEl.createEl('p', { text: unit.labels.map(a => `${a.id} (${a.confidence})`).join(', ') });
      this.contentEl.createEl('pre').createEl('code', { text: sourceText.slice(unit.source.startOffset, unit.source.endOffset) });
    }
    const details = this.contentEl.createEl('details');
    details.createEl('summary', { text: 'Frame JSON' });
    details.createEl('pre').createEl('code', { text: JSON.stringify(frame, null, 2) });
  }
  onClose() { this.contentEl.empty(); }
}

// 창을 여는 시점의 호출 이력과 평가 추적 정보를 표시한다.
class AttemptModal extends Modal {
  constructor(app: DocumentFramer['app'], private plugin: DocumentFramer) { super(app); }
  onOpen() {
    this.contentEl.addClass('document-framer');
    this.contentEl.createEl('h2', { text: 'Gemini 호출 기록' });
    this.contentEl.createEl('p', { text: `현재 연결: ${this.plugin.connectionState} · 이전 세션 종료 미확인 ${this.plugin.journal.unresolved.length}건. 기록은 Frame과 독립적이며 미확인 사용량은 0이 아닙니다. 비용은 환산하지 않습니다.` });
    this.contentEl.createEl('p', { text: '응답 수신 기록은 분류 검증 성공이나 사용자의 분류 수용을 의미하지 않습니다. 사용량은 실패한 응답에도 남을 수 있습니다.' });
    this.contentEl.createEl('p', { text: '같은 세션에서는 실제 HTTP 종료까지 호출 잠금을 유지합니다. 재시작 후에는 설정에서 중복 처리·과금 가능성을 확인하고 새 요청을 직접 선택할 수 있습니다. 로컬 종료는 원격 취소를 뜻하지 않습니다. 최신 상태는 이 창을 다시 열어 확인하세요.' });
    if (this.plugin.journal.persistenceError) this.contentEl.createEl('p', { text: '호출 기록 저장 실패. 최신 메모리 기록을 확인하고 저장소 문제를 해결하세요.' });
    for (const attempt of this.plugin.journal.attempts) {
      this.contentEl.createEl('p', { text: attemptSummary(attempt) });
      const details = this.contentEl.createEl('details');
      details.createEl('summary', { text: `${attempt.trace?.documentPath ?? '연결 확인'} · 평가 추적 JSON` });
      details.createEl('pre').createEl('code', { text: JSON.stringify(attempt, null, 2) });
    }
  }
  onClose() { this.contentEl.empty(); }
}
