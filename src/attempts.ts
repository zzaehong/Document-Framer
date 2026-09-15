/**
 * API 호출 이력 계층. 사용자 요청 하나(runId)에 최초 전송과 재시도별 Attempt가 속한다.
 * HTTP 종료 여부·사용량을 Frame 생성 성공과 별도로 기록하여 늦은 응답과 재시작을 추적한다.
 */
import type { EvaluationTrace } from './evaluation';

export const TOKEN_FIELDS = ['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount', 'cachedContentTokenCount', 'thoughtsTokenCount', 'toolUsePromptTokenCount'] as const;
export type TokenField = typeof TOKEN_FIELDS[number];
export interface Usage { status: 'confirmed' | 'unknown'; tokens: Record<TokenField, number | null> }
// 없거나 잘못된 토큰 수는 null로 보존한다. 사용량 미확인을 0으로 취급하지 않는다.
export function readUsage(value: unknown): Usage {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const tokens = Object.fromEntries(TOKEN_FIELDS.map(field => [field, Number.isSafeInteger(data[field]) && (data[field] as number) >= 0 ? data[field] : null])) as Usage['tokens'];
  return { status: tokens.promptTokenCount !== null && tokens.candidatesTokenCount !== null && tokens.totalTokenCount !== null ? 'confirmed' : 'unknown', tokens };
}
// transport는 로컬 전송 상태, outcome은 응답 처리 결과다. response도 분류 검증 성공을 뜻하지 않는다.
export interface Attempt {
  id: string;
  revision: number;
  sessionId: string;
  trace: EvaluationTrace | null;
  runId: string;
  purpose: 'connection' | 'classification';
  attemptNumber: number;
  requestedModel: string;
  modelVersion: string | null;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  transport: 'pending' | 'settled' | 'not-sent';
  outcome: 'pending' | 'response' | 'http-error' | 'network-error' | 'invalid-response' | 'not-sent';
  httpStatus: number | null;
  timedOutAt: number | null;
  usage: Usage;
  acknowledgedSessionId?: string;
}
// 저장된 이력의 기본 구조를 검사하고 복제하여 저장소 객체와 메모리 기록의 참조를 분리한다.
export function decodeAttempts(value: unknown): Attempt[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(a => !a || typeof a.id !== 'string' || typeof a.sessionId !== 'string'
    || typeof a.runId !== 'string' || !['connection', 'classification'].includes(a.purpose)
    || !['pending', 'settled', 'not-sent'].includes(a.transport) || !Number.isInteger(a.revision)
    || !a.usage || !['confirmed', 'unknown'].includes(a.usage.status) || !a.usage.tokens)) throw new Error('Unsupported attempts');
  return structuredClone(value);
}

/** Frame 성공 여부와 무관하게 동일 시도 ID를 갱신한다. 늦은 이벤트는 중복 집계하지 않는다. */
export class AttemptJournal {
  readonly sessionId = crypto.randomUUID();
  private records = new Map<string, Attempt>();
  private writes: Promise<void> = Promise.resolve();
  private active = true;
  persistenceError = false;
  constructor(private persist: (attempts: Attempt[]) => Promise<void>, private changed = () => {}) {}
  load(attempts: Attempt[]) { this.records = new Map(attempts.map(a => [a.id, structuredClone(a)])); }
  get attempts() { return [...this.records.values()]; }
  // 현재 세션이 아닌 기록 중 HTTP 종료가 확인되지 않은 항목을 재시작 복구 대상으로 잡는다.
  get unresolved() { return this.attempts.filter(a => a.transport === 'pending' && a.sessionId !== this.sessionId); }
  get needsAcknowledgement() { return this.unresolved.some(a => a.acknowledgedSessionId !== this.sessionId); }
  close() { this.active = false; }
  async record(attempt: Attempt) {
    if (!this.active) return;
    const prior = this.records.get(attempt.id);
    // 시간 초과 기록과 늦은 응답 기록의 도착 순서가 바뀌어도 최신 revision만 반영한다.
    if (prior && prior.revision >= attempt.revision) return;
    this.records.set(attempt.id, structuredClone(attempt));
    this.changed();
    await this.save();
  }
  // 저장 요청은 순서대로 실행한다. 실패해도 메모리 기록은 유지하여 화면에 상태를 알린다.
  private save() {
    const write = this.writes.then(async () => {
      if (!this.active) return;
      try { await this.persist(structuredClone(this.attempts)); this.persistenceError = false; }
      catch { this.persistenceError = true; throw new Error('호출 기록을 저장하지 못했습니다. 저장소를 확인하세요.'); }
      finally { this.changed(); }
    });
    this.writes = write.catch(() => {});
    return write;
  }
  // 사용자 확인은 현재 세션에만 적용한다. 저장 실패 시 확인 표시를 되돌려 호출 차단을 유지한다.
  async acknowledgeUnresolved() {
    const ids = this.unresolved.map(a => a.id);
    for (const id of ids) this.records.get(id)!.acknowledgedSessionId = this.sessionId;
    try { await this.save(); }
    catch (error) { for (const id of ids) delete this.records.get(id)!.acknowledgedSessionId; throw error; }
  }
  flush() { return this.writes; }
}
// 화면에 보여줄 한 줄 요약. 미확인 사용량·시간은 추정값으로 채우지 않는다.
export function attemptSummary(a: Attempt): string {
  const count = (field: TokenField) => a.usage.tokens[field] ?? '미확인';
  const state = a.transport === 'pending' ? 'HTTP 종료 미확인' : a.transport === 'not-sent' ? '미전송' : '로컬 HTTP 종료';
  return `${a.purpose === 'connection' ? '연결 확인' : '분류'} · 실행 ${a.runId} · 시도 ${a.attemptNumber}${a.attemptNumber > 1 ? ' (재시도)' : ''} · ${state}${a.timedOutAt !== null ? ' · 시간 초과' : ''} · ${a.outcome} · 사용량 ${a.usage.status === 'confirmed' ? '확인' : '미확인/일부 확인'} · 입력 ${count('promptTokenCount')} / 출력 ${count('candidatesTokenCount')} / 총 ${count('totalTokenCount')} tokens · 지연 ${a.durationMs === null ? '미확인' : `${a.durationMs}ms`}`;
}
