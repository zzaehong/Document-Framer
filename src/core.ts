export const WAIT_MS = 60_000;
export const MAX_BYTES = 2 * 1024 * 1024;
export interface Source { path: string; basename: string; ctime: number; mtime: number; text: string }
export interface Frame {
  schemaVersion: 1;
  engine: 'local-test-v1';
  generatedAt: string;
  document: { path: string; title: string; createdAt: number; modifiedAt: number; bytes: number; lineCount: number; headings: { level: number; text: string; line: number }[]; domains: string[]; type: null; confidence: null; importance: null };
  knowledgeUnits: { id: string; source: { startLine: number; endLine: number }; labels: string[]; confidence: null; highlight: boolean }[];
}
export class TestEngine {
  generate(source: Source): Frame {
    if (!source.text.trim()) throw new Error('처리할 내용이 없습니다.');
    const bytes = new TextEncoder().encode(source.text).length;
    if (bytes > MAX_BYTES) throw new Error('처리 한도(2 MiB)를 초과했습니다.');
    const lines = source.text.split(/\r?\n/);
    const headings: Frame['document']['headings'] = [];
    let fence = '';
    lines.forEach((line, index) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ''; return; }
      if (fence) return;
      const match = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (match) headings.push({ level: match[1].length, text: match[2], line: index + 1 });
    });
    return { schemaVersion: 1, engine: 'local-test-v1', generatedAt: new Date().toISOString(),
      document: { path: source.path, title: headings.find(h => h.level === 1)?.text ?? source.basename, createdAt: source.ctime, modifiedAt: source.mtime, bytes, lineCount: lines.length, headings, domains: [], type: null, confidence: null, importance: null },
      knowledgeUnits: [{ id: 'test-unit-1', source: { startLine: 1, endLine: lines.length }, labels: ['TEST_ONLY'], confidence: null, highlight: false }] };
  }
}
interface Job { text: string; changedAt: number; requested: boolean; running: boolean }
/** Fixed stability gate; observation alone never authorizes execution. */
export class ManualQueue {
  private jobs = new Map<string, Job>();
  observe(path: string, text: string, modifiedAt: number, now: number) {
    const job = this.jobs.get(path);
    if (!job) this.jobs.set(path, { text, changedAt: Math.min(modifiedAt, now), requested: false, running: false });
    else if (job.text !== text) { job.text = text; job.changedAt = now; }
  }
  request(path: string) { const job = this.jobs.get(path); if (job && !job.running) job.requested = true; }
  remaining(path: string, now: number) { const job = this.jobs.get(path); return job ? Math.max(0, job.changedAt + WAIT_MS - now) : 0; }
  pending(path: string) { return this.jobs.get(path)?.requested ?? false; }
  takeReady(now: number): string[] {
    const ready: string[] = [];
    for (const [path, job] of this.jobs) if (job.requested && !job.running && this.remaining(path, now) === 0) { job.requested = false; job.running = true; ready.push(path); }
    return ready;
  }
  finish(path: string) { const job = this.jobs.get(path); if (job) job.running = false; }
  remove(path: string) { this.jobs.delete(path); }
}
