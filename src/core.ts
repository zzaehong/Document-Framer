/**
 * Obsidian에 의존하지 않는 로컬 처리 계층. Source는 입력 원문, Frame은 별도 분석 결과다.
 * TestEngine은 메타데이터를 만들고, ManualQueue는 문서별 수동 요청과 60초 안정 대기를 관리한다.
 */
// 마지막 내용 변경 후 필요한 안정 시간과 로컬 입력의 UTF-8 바이트 한도.
export const WAIT_MS = 60_000;
export const MAX_BYTES = 2 * 1024 * 1024;
export interface Source { path: string; basename: string; ctime: number; mtime: number; text: string }
// schemaVersion 1은 로컬 테스트 결과다. null 분류값과 TEST_ONLY는 AI 분석을 하지 않았다는 표시다.
export interface Frame {
  schemaVersion: 1;
  engine: 'local-test-v1';
  generatedAt: string;
  document: { path: string; title: string; createdAt: number; modifiedAt: number; bytes: number; lineCount: number; headings: { level: number; text: string; line: number }[]; domains: string[]; type: null; confidence: null; importance: null };
  knowledgeUnits: { id: string; source: { startLine: number; endLine: number }; labels: string[]; confidence: null; highlight: boolean }[];
}
export class TestEngine {
  // 빈 원문·용량을 검사한 다음 제목, 줄 수와 전체 문서를 가리키는 테스트 지식 단위를 만든다.
  generate(source: Source): Frame {
    if (!source.text.trim()) throw new Error('처리할 내용이 없습니다.');
    const bytes = new TextEncoder().encode(source.text).length;
    if (bytes > MAX_BYTES) throw new Error('처리 한도(2 MiB)를 초과했습니다.');
    const lines = source.text.split(/\r?\n/);
    const headings: Frame['document']['headings'] = [];
    // 코드 울타리 안의 #은 문서 제목으로 세지 않도록 울타리의 시작·끝을 추적한다.
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
