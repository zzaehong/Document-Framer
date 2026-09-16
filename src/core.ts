/** 수동 요청과 문서별 안정 대기. 실제 구조 생성은 structure.ts에 분리한다. */
export const WAIT_MS = 60_000;
export { MAX_LOCAL_BYTES as MAX_BYTES, StructuralEngine } from './structure';
export type { StructuralFrame as Frame } from './structure';
export interface Source { path: string; basename: string; ctime: number; mtime: number; text: string }
// changedAt은 내용 변경 기준 시각, requested는 수동 요청 여부, running은 처리 중 여부다.
interface Job { text: string; changedAt: number; requested: boolean; running: boolean }
/** 수동 요청이 있어야 실행하는 안정 대기 큐. 내용 관찰만으로는 실행하지 않는다. */
export class ManualQueue {
  private jobs = new Map<string, Job>();
  // 처음 본 파일은 수정 시각을 사용한다. 이후에는 텍스트가 달라진 경우에만 대기 시작점을 갱신한다.
  observe(path: string, text: string, modifiedAt: number, now: number) {
    const job = this.jobs.get(path);
    if (!job) this.jobs.set(path, { text, changedAt: Math.min(modifiedAt, now), requested: false, running: false });
    else if (job.text !== text) { job.text = text; job.changedAt = now; }
  }
  request(path: string) { const job = this.jobs.get(path); if (job && !job.running) job.requested = true; }
  remaining(path: string, now: number) { const job = this.jobs.get(path); return job ? Math.max(0, job.changedAt + WAIT_MS - now) : 0; }
  pending(path: string) { return this.jobs.get(path)?.requested ?? false; }
  // 대기가 끝난 요청을 처리 중으로 전환하면서 반환하므로 다음 검사에서 중복 선택되지 않는다.
  takeReady(now: number): string[] {
    const ready: string[] = [];
    for (const [path, job] of this.jobs) if (job.requested && !job.running && this.remaining(path, now) === 0) { job.requested = false; job.running = true; ready.push(path); }
    return ready;
  }
  finish(path: string) { const job = this.jobs.get(path); if (job) job.running = false; }
  remove(path: string) { this.jobs.delete(path); }
}
