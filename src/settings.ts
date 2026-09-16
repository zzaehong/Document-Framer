/**
 * Obsidian 설정 화면: 호출 기록 확인, 미해결 요청 확인, API 키 저장·삭제와 연결 검사를 연결한다.
 * 화면 이벤트는 main.ts의 메서드를 호출하며 실제 통신·저장은 각 담당 클래스에 맡긴다.
 */
import { App, PluginSettingTab, Setting, TextComponent } from 'obsidian';
import type DocumentFramer from './main';
import { MODEL } from './storage';
import { BUDGET, MAX_HTTP_ATTEMPTS } from './budget';

export class FramerSettingsTab extends PluginSettingTab {
  constructor(app: App, private framer: DocumentFramer) { super(app, framer); }
  display() {
    const el = this.containerEl;
    el.empty();
    el.createEl('h2', { text: 'Document Framer · Gemini' });
    el.createEl('p', { text: `긴 문서는 최대 ${BUDGET.maxChunks}개 청크로 처리합니다. 문서당 최대 ${BUDGET.maxLogicalRequests}회 요청, 재시도 포함 최대 ${BUDGET.maxHttpAttempts}회 전송입니다.` });
    el.createEl('p', { text: `모델: ${MODEL} · 동시 호출 1개 · 일시 오류 재시도 최대 ${MAX_HTTP_ATTEMPTS - 1}회 · 모델 자동 전환 없음` });
    el.createEl('p', { text: '미리보기 요청 시 현재 문서의 텍스트를 Google Gemini로 전송합니다. API 이용 요금이 발생할 수 있습니다. 연결 확인은 짧은 테스트 문장만 전송합니다.' });
    el.createEl('p', { text: '무상 API에서는 입력·출력이 제품·머신러닝 개선에 이용되고 사람이 검토할 수 있습니다. 민감·기밀·개인정보를 보내지 마세요. 프런트매터와 코드도 전송됩니다. 유료 서비스는 제품 개선에 사용하지 않지만 안전·보안 목적의 제한적 보관이 있습니다.' });
    el.createEl('p', { text: 'API는 활성 결제 계정에 연결된 프로젝트로 접근할 때 유료 서비스에 해당합니다. EEA·스위스·영국은 무상 이용에도 유료 서비스의 데이터 처리 조건이 적용되는 예외가 있습니다. 키나 연결 성공만으로 적용 조건을 판정하지 않습니다. 정책 확인: 2026-09-15.' });
    el.createEl('a', { text: 'Google 공식 데이터 이용 조건', attr: { href: 'https://ai.google.dev/gemini-api/terms', target: '_blank', rel: 'noopener noreferrer' } });
    new Setting(el).setName('호출 기록·복구').setDesc('사용량 미확인은 0으로 계산하지 않습니다. 로컬 HTTP 종료는 원격 취소가 아닙니다.')
      .addButton(button => button.setButtonText('기록 보기').onClick(() => this.framer.showAttempts()));
    if (this.framer.journal.unresolved.length) {
      el.createEl('p', { text: `이전 세션의 HTTP 종료 미확인 ${this.framer.journal.unresolved.length}건. 자동 재전송하지 않습니다. 새 요청은 중복 처리·과금을 일으킬 수 있습니다.` });
      new Setting(el).setName('미해결 요청 확인').setDesc('확인은 이전 요청을 취소하거나 재전송하지 않습니다. 이후 연결 확인 또는 문서 요청을 직접 선택하세요.')
        .addButton(button => button.setButtonText('중복 처리·과금 가능성을 확인하고 새 요청 허용').onClick(async () => {
          button.setDisabled(true);
          try { await this.framer.acknowledgeUnresolved(); this.display(); }
          catch { button.setButtonText('확인 저장 실패 · 다시 시도'); button.setDisabled(false); }
        }));
    }
    if (!this.framer.key.supported) {
      el.createEl('p', { text: '공식 비밀 저장 기능에는 Obsidian 1.11.4 이상이 필요합니다. 업데이트 후 다시 설정하세요.' });
      return;
    }
    const status = el.createEl('p', { attr: { role: 'status' } });
    const showState = () => {
      try { status.setText(this.framer.key.read() ? 'API 키 저장됨' : '저장된 API 키 없음'); }
      catch { status.setText('비밀 저장소를 읽지 못했습니다.'); }
    };
    showState();
    let input: TextComponent;
    let busy = false;
    // 설정 작업 중 중복 클릭을 막고 공통 상태 메시지를 갱신한다.
    const action = async (work: () => Promise<void>, success: string) => {
      if (busy) return;
      busy = true;
      status.setText('처리 중…');
      try { await work(); status.setText(success); }
      catch { status.setText('설정 처리 실패. 비밀 저장소와 data.json 상태를 확인하세요.'); }
      finally { busy = false; }
    };
    new Setting(el).setName('Gemini API 키').setDesc('Document Framer 전용 Obsidian 비밀 저장소에 저장합니다. 기존 키는 화면에 표시하지 않습니다.')
      .addText(text => { input = text; text.inputEl.type = 'password'; text.inputEl.autocomplete = 'off'; text.setPlaceholder('API 키 입력'); })
      .addButton(button => button.setButtonText('저장').onClick(() => {
        // 입력값을 작업용 변수로 옮긴 뒤 화면을 즉시 비운다. 일반 설정 저장에 성공해야 키를 교체한다.
        const value = input.getValue(); input.setValue('');
        return action(async () => {
          await this.framer.saveSettings();
          this.framer.key.save(value);
        }, 'API 키 저장됨');
      }))
      .addButton(button => button.setButtonText('삭제').onClick(() => {
        input.setValue('');
        return action(async () => { this.framer.key.clear(); }, 'API 키 삭제됨');
      }));
    new Setting(el).setName('연결 확인').setDesc('저장한 키로 기본 모델과 분류 응답 형식을 확인합니다.')
      .addButton(button => button.setButtonText('연결 확인').onClick(async () => {
        if (busy) return;
        busy = true; button.setDisabled(true); status.setText('Gemini 연결 확인 중…');
        try { await this.framer.checkConnection(); status.setText('연결 성공 · 기본 모델의 분류 응답 검증 완료'); }
        catch (error) { status.setText(error instanceof Error ? error.message : '연결 확인 실패'); }
        finally { busy = false; button.setDisabled(false); }
      }));
  }
}
