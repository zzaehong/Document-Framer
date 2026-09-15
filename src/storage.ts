/**
 * 영구 저장 계층: data.json의 형식 복원과 순차 저장을 담당한다.
 * 로컬 Frame·설정·호출 기록은 함께 저장하고, API 키는 Obsidian 비밀 저장소로 분리한다.
 */
import { Frame } from './core';
import { Attempt, decodeAttempts } from './attempts';
import { Domain, decodeDomains, domainKey } from './domains';

export const MODEL = 'gemini-3.1-flash-lite';
export const SECRET_ID = 'document-framer-gemini-api-key';
export interface Settings { model: typeof MODEL; secretId: typeof SECRET_ID }
export interface Saved { version: 3; settings: Settings; frames: Record<string, Frame>; attempts: Attempt[]; domains: Domain[] }
const defaults = (): Saved => ({ version: 3, settings: { model: MODEL, secretId: SECRET_ID }, frames: Object.create(null), attempts: [], domains: [] });

// 처음 실행이면 기본값을 만들고, 기존 데이터는 지원 버전·설정만 받아 현재 저장 구조로 복원한다.
export function decodeSaved(value: unknown): Saved {
  if (value == null) return defaults();
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Unsupported storage');
  const data = value as Record<string, unknown>;
  if (![1, 2, 3].includes(data.version as number) || !data.frames || typeof data.frames !== 'object' || Array.isArray(data.frames)) throw new Error('Unsupported storage');
  if (data.version === 2 || data.version === 3) {
    const settings = data.settings as Settings | undefined;
    // 사용자 요청에 따른 모델 이전. 과거 호출 기록의 모델·생성 설정은 보존한다.
    if (!settings || ![MODEL, 'gemini-2.5-flash-lite'].includes(settings.model) || settings.secretId !== SECRET_ID) throw new Error('Unsupported settings');
  }
  // 구버전 Frame은 재분류하거나 변형하지 않고 그대로 옮긴다. 키 값은 저장 대상이 아니다.
  return { ...defaults(), frames: Object.assign(Object.create(null), data.frames), attempts: decodeAttempts(data.attempts), domains: data.version === 3 ? decodeDomains(data.domains) : [] };
}

// 모든 저장 경로가 하나의 Promise 사슬을 공유하여 동시에 저장해도 서로의 데이터를 덮어쓰지 않는다.
export class FrameStore {
  state = defaults();
  private writes: Promise<void> = Promise.resolve();
  constructor(private write: (data: Saved) => Promise<void>) {}
  load(value: unknown) { this.state = decodeSaved(value); }
  private update(change: (current: Saved) => Saved): Promise<void> {
    // 설정 저장과 Frame 저장이 겹쳐도 직전 성공 상태를 기준으로 병합한다.
    const result = this.writes.then(async () => {
      const next = change(this.state);
      // 디스크 저장이 성공한 뒤에만 메모리 상태를 교체한다.
      await this.write(next);
      this.state = next;
    });
    // 실패는 이번 호출자에게 전달하되 내부 사슬을 복구하여 다음 저장이 계속 실행되게 한다.
    this.writes = result.catch(() => {});
    return result;
  }
  // 복사본을 반환하여 요청 중 Catalog가 바뀌어도 입력 스냅샷이 변하지 않게 한다.
  getDomains(): Domain[] { return structuredClone(this.state.domains); }
  saveDomain(domain: Domain) {
    const [candidate] = decodeDomains([domain]);
    return this.update(current => {
      const existing = current.domains.find(item => domainKey(item.path) === domainKey(candidate.path));
      if (existing) {
        if (JSON.stringify(existing.path) !== JSON.stringify(candidate.path)) throw new Error('이미 저장된 Domain 표기와 다릅니다.');
        return current;
      }
      return { ...current, domains: [...current.domains, candidate] };
    });
  }
  saveSettings() { return this.update(current => ({ ...current, settings: { model: MODEL, secretId: SECRET_ID } })); }
  saveAttempts(attempts: Attempt[]) { return this.update(current => ({ ...current, attempts })); }
  saveFrame(path: string, frame: Frame) {
    return this.update(current => ({ ...current, frames: Object.assign(Object.create(null), current.frames, { [path]: frame }) }));
  }
}

export interface SecretStorage { getSecret(id: string): string | null; setSecret(id: string, value: string): void }
// 키 원문은 전용 비밀 저장소에서만 읽고 쓴다. 일반 설정에는 비밀 항목 ID만 남긴다.
export class GeminiKey {
  constructor(private storage: SecretStorage | undefined) {}
  get supported() { return !!this.storage; }
  read() {
    if (!this.storage) throw new Error('키 저장에는 Obsidian 1.11.4 이상이 필요합니다.');
    try { return this.storage.getSecret(SECRET_ID)?.trim() || null; }
    catch { throw new Error('비밀 저장소를 읽지 못했습니다.'); }
  }
  save(value: string) {
    if (!value.trim() || /\s/.test(value.trim())) throw new Error('공백 없는 API 키를 입력하세요.');
    this.set(value.trim());
  }
  clear() { this.set(''); }
  private set(value: string) {
    if (!this.storage) throw new Error('키 저장에는 Obsidian 1.11.4 이상이 필요합니다.');
    // 공식 API에 삭제 메서드가 없어 전용 항목의 비밀 값을 비운다.
    try { this.storage.setSecret(SECRET_ID, value); }
    catch { throw new Error('비밀 저장소에 쓰지 못했습니다.'); }
  }
}
