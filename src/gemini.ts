import { MAX_HTTP_ATTEMPTS, RETRY_BASE_MS, RETRY_JITTER_MS, RETRY_MAX_MS } from './budget';
/**
 * HTTP 통신 계층: 인증 헤더와 요청 구성, 호출 잠금, 제한된 재시도, 응답 JSON 추출을 담당한다.
 * 분류 내용의 타당성은 classification.ts가 검증한다. 실제 전송 함수는 주입하여 테스트에서 대체한다.
 */
import { MODEL } from './storage';
import { Attempt, readUsage } from './attempts';
import { EvaluationTrace, GENERATION_CONFIG } from './evaluation';

export interface HttpRequest { url: string; method: string; headers: Record<string, string>; body: string; throw: false }
export interface HttpResponse { status: number; text: string }
export type Transport = (request: HttpRequest) => Promise<HttpResponse>;
export interface GenerationResult { value: unknown; modelVersion: string | null }
export class GeminiError extends Error {}
const transient = new Set([408, 500, 502, 503, 504]);
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export interface AttemptObserver { sessionId: string; record(attempt: Attempt): Promise<void> }

/** 연결 확인과 분류가 하나의 HTTP 잠금을 공유한다. 기록 저장은 전송보다 먼저 완료한다. */
export class GeminiClient {
  private busy = false;
  private closed = false;
  private timedOut = false;
  private sessionId = crypto.randomUUID();
  constructor(private transport: Transport, private sleep = delay, private timeoutMs = 60_000, private observer?: AttemptObserver, private random = Math.random) {}
  get status() { return this.busy ? (this.timedOut ? 'timeout-pending' : 'running') : 'idle'; }
  close() { this.closed = true; }
  async generate(key: string, system: string, input: unknown, schema: unknown, trace?: EvaluationTrace, isValid = () => true): Promise<GenerationResult> {
    if (this.closed || !isValid()) throw new GeminiError('요청이 종료되었습니다.');
    if (this.busy) throw new GeminiError(this.timedOut ? '시간 초과한 HTTP가 아직 진행 중입니다. 같은 세션에서는 종료 후에만 새 요청이 가능합니다.' : 'Gemini 요청이 진행 중입니다. 완료 후 다시 요청하세요.');
    if (!key.trim()) throw new GeminiError('설정에서 Gemini API 키를 저장하세요.');
    this.busy = true; this.timedOut = false;
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Attempt | undefined;
    const runId = trace?.runId ?? crypto.randomUUID();
    // 동일 시도의 revision을 올려 스냅샷을 저장한다. 뒤늦은 이전 기록이 최신 상태를 덮지 않게 한다.
    const record = async () => {
      if (!current) return;
      current.revision++;
      try { await this.observer?.record(structuredClone(current)); }
      catch { throw new GeminiError('호출 기록을 저장하지 못했습니다. 저장소를 확인하고 다시 요청하세요.'); }
    };
    const stop = () => expired || this.closed || !isValid();
    const operation = async () => {
      try {
        const request: HttpRequest = {
          url: `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, method: 'POST', throw: false,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
            generationConfig: { ...GENERATION_CONFIG, responseJsonSchema: schema } }),
        };
        // 일시 오류만 최대 3회 전송한다. 지수 backoff에 작은 jitter를 더하며 timeout 잠금은 유지한다.
        for (let attempt = 1; attempt <= MAX_HTTP_ATTEMPTS; attempt++) {
          if (stop()) throw new GeminiError('요청이 종료되었습니다.');
          current = { id: `${runId}:${attempt}`, revision: 0, sessionId: this.observer?.sessionId ?? this.sessionId,
            trace: trace ?? null, runId, purpose: trace?.purpose ?? 'connection', attemptNumber: attempt,
            requestedModel: MODEL, modelVersion: null, startedAt: Date.now(), endedAt: null, durationMs: null,
            transport: 'pending', outcome: 'pending', httpStatus: null, timedOutAt: null, usage: readUsage(null) };
          // 전송 전 기록 저장이 실패하면 API를 호출하지 않고 미전송 상태를 남긴다.
          try { await record(); }
          catch (error) {
            current.transport = 'not-sent'; current.outcome = 'not-sent';
            await record().catch(() => {}); throw error;
          }
          if (stop()) {
            current.transport = 'not-sent'; current.outcome = 'not-sent';
            await record(); throw new GeminiError('요청이 종료되었습니다.');
          }
          // 실제 전송 시점부터 HTTP가 종료될 때까지 측정하므로 사전 기록 저장 시간은 제외한다.
          const sentAt = Date.now();
          let response: HttpResponse;
          try { response = await this.transport(request); }
          catch {
            current.endedAt = Date.now(); current.durationMs = current.endedAt - sentAt;
            current.transport = 'settled'; current.outcome = 'network-error';
            await record();
            if (attempt < MAX_HTTP_ATTEMPTS && !stop()) { await this.sleep(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1) + this.random() * RETRY_JITTER_MS)); continue; }
            throw new GeminiError('네트워크 연결에 실패했습니다. 원격 처리·사용량은 미확인입니다.');
          }
          // timeout/삭제/이동 뒤에도 사용량은 먼저 동일 시도에 반영한다.
          current.endedAt = Date.now(); current.durationMs = current.endedAt - sentAt;
          current.transport = 'settled'; current.httpStatus = response.status;
          let envelope: any = null;
          try { envelope = JSON.parse(response.text); } catch { /* 본문/예외는 기록하지 않는다. */ }
          current.usage = readUsage(envelope?.usageMetadata);
          current.modelVersion = typeof envelope?.modelVersion === 'string' && /^gemini-[a-zA-Z0-9._-]{1,150}$/.test(envelope.modelVersion) ? envelope.modelVersion : null;
          current.outcome = response.status === 200 ? 'response' : 'http-error';
          await record();
          if (stop()) throw new GeminiError('요청이 종료되었습니다. 늦은 응답의 사용량은 호출 기록에서 확인하세요.');
          if (response.status !== 200) {
            if (attempt < MAX_HTTP_ATTEMPTS && transient.has(response.status)) { await this.sleep(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1) + this.random() * RETRY_JITTER_MS)); continue; }
            const hint = response.status === 401 || response.status === 403 ? 'API 키와 사용 권한을 확인하세요.'
              : response.status === 429 ? '요청·사용량·결제 한도를 확인하세요.'
              : response.status === 404 ? '기본 모델의 지원 여부를 확인하세요. 자동 전환하지 않습니다.'
              : response.status === 400 ? '요청 형식·지역·계정 설정을 확인하세요.' : '잠시 후 다시 요청하세요.';
            throw new GeminiError(`Gemini 오류 (${response.status}). ${hint}`);
          }
          // 정상 종료된 단일 후보의 텍스트만 JSON으로 해석한다. 오류 응답 원문은 사용자 오류에 포함하지 않는다.
          try {
            const candidates = envelope?.candidates;
            if (envelope?.promptFeedback?.blockReason || !Array.isArray(candidates) || candidates.length !== 1 || candidates[0].finishReason !== 'STOP') throw new Error();
            const parts = candidates[0].content?.parts;
            if (!Array.isArray(parts) || !parts.length || parts.some(p => typeof p.text !== 'string' || p.thought)) throw new Error();
            return { value: JSON.parse(parts.map(p => p.text).join('')), modelVersion: current.modelVersion };
          } catch {
            current.outcome = 'invalid-response'; await record();
            throw new GeminiError('Gemini 응답이 차단·중단되었거나 JSON 형식이 올바르지 않습니다. 다시 요청하세요.');
          }
        }
        throw new GeminiError('Gemini 요청에 실패했습니다.');
      } finally { this.busy = false; this.timedOut = false; }
    };
    // 로컬 대기 시간과 실제 HTTP 수명을 분리한다. 시간 초과가 먼저 와도 operation의 잠금은 유지한다.
    const pending = operation();
    try {
      return await Promise.race([pending, new Promise<never>((_, reject) => {
        // 시간 초과를 기록하고 호출자에게 실패를 알린다. 늦은 HTTP 응답은 위 operation에서 계속 정리한다.
        timer = setTimeout(() => {
          expired = true; this.timedOut = true;
          if (current && current.endedAt === null) { current.timedOutAt = Date.now(); void record().catch(() => {}); }
          reject(new GeminiError('Gemini 응답 시간이 초과되었습니다. HTTP 종료 미확인 상태이며 취소된 것이 아닙니다. 같은 세션에서는 실제 연결 종료까지 새 호출을 막습니다. 재시작 후 복구 안내는 설정에서 확인하세요.'));
        }, this.timeoutMs);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
}
