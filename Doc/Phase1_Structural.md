# Markdown-aware Phase 1 설계

최신 prompt.md에 따른 현재 설계다. Phase 1은 원문 구조를 관찰하고 Phase 2는 의미를 해석한다.

- Structural Frame: schema 6, engine local-structural-v1. 기존 local 1 / Gemini 2~5와 구분한다. 원문 전체 텍스트를 저장하지 않고 UTF-16 [startOffset,endOffset)와 1-based 행, 원문 UTF-8 SHA-256을 저장한다. semantic.status는 not-run이다.
- Section: root는 전체 문서다. heading section은 제목부터 다음 동급/상위 제목 직전까지 subtree 범위다. parentId/childIds가 hierarchy이며 blockIds는 직접 소속만 포함한다. 건너뛴 heading level은 가장 가까운 낮은 level에 연결한다. 블록은 정확히 한 section에 직접 소속된다.
- Parser: 원문 offset을 보존하는 결정론 블록 파서. ATX/Setext 제목, 문단, ordered/unordered/nested 목록, 인용, fenced/indented 코드, 탐지 가능한 GFM 표, frontmatter, 수평선을 구분한다. 완전한 CommonMark/YAML 파서가 아니며 YAML 값을 해석하거나 의미를 추론하지 않는다.
- Context Builder: 저장 Frame과 별도. hash 일치 확인 후 section subtree 전체 → child section → 연속 direct blocks → oversized paragraph/list fallback 순으로 처리한다. 서로 다른 H1 주제는 합치지 않고 같은 부모의 작은 인접 section만 병합한다. root 자체로 여러 H1을 한 요청에 묶지 않는다.
- Context source ranges는 공백을 포함해 원문을 순서대로 정확히 한 번 덮는다. 부모 heading wrapper는 별도 문자열이며 coverage에서 제외한다. wrapper를 포함한 renderedMarkdown UTF-8 크기와 block 수에 예산을 적용한다.
- oversized code/table/frontmatter/heading은 명시적 오류다. paragraph는 간단한 문장 → 줄 → Unicode-safe 경계, list는 최상위 item → 필요할 때 item 내부 fallback이다. 인용은 줄 경계 우선이다. 무음 절단과 본문 overlap은 없다.
- Gemini에는 기존 블록 종류/본문과 함께 별도 중복 원문을 전송하지 않는다. contextMarkdown과 frontmatter 식별 범위를 전달하고 기존 semantic output 계약을 유지한다. Context ID/Section ID를 trace에 추가한다.
- data.json v3 유지, 기존 결과는 legacy로 보존하고 사용자 수동 local Framing 시 해당 문서만 교체한다. 구조 Frame 생성은 모델/API를 호출하지 않는다. 기존 대기·저장·파일 신원 보호를 유지한다.

## 구현 결과

- `src/blocks.ts`: Markdown block parser 및 원문 위치 계산. `src/structure.ts`: Section Tree·통계·Grounding Signals·StructuralEngine/schema 6. 본문 text는 저장하지 않는다.
- `src/context.ts`: source hash 확인, Section-first 계획, parent heading wrapper, 블록/목록/문단 fallback 및 같은 부모의 작은 section 연속 병합. 이전 `src/chunks.ts`는 제거했다.
- `src/core.ts`: 기존 ManualQueue 유지, TEST_ONLY 생성 제거. `src/storage.ts`: data.json v3 유지 및 구조 Frame 저장, 대기 중 무효화된 쓰기 차단.
- `src/main.ts`: 비동기 로컬 hash 처리의 파일 신원 검사, 구조 조회 UI. `src/framing.ts`: 구조 Frame → Context → Gemini, 기존 Gemini schema 5 metadata/의미 계약 유지.
- `src/concept-prompts.ts`: 입력 설명만 contextMarkdown/frontmatterRanges로 갱신(prompt v3). 의미 지침은 유지한다. `src/budget.ts`: pipeline v3. `src/evaluation.ts`: contextUnitId/sectionId/structureVersion 추적.
- PRD 0.8, Brief, MVP Plan, Phase 2 이력과 README를 현재 구조에 맞췄다. 사용자 prompt.md 원문은 수정하지 않았다.

## 검증 (2026-09-16)

- `npm test`: **103 passed, 0 failed**. 네트워크를 사용하지 않는다. tsx IPC 허용 환경에서 실행했다.
- `npm run test:vault`: 내부 `npm run build`의 TypeScript 검사 및 bundle 생성 성공. `.test-vault/.obsidian/plugins/document-framer`의 main.js/manifest.json/styles.css 갱신.
- `git diff --check`: 통과.
- 구조 테스트: heading hierarchy/건너뛴 level/Setext/code 보호, 목록·인용·표·frontmatter, Section 보존/child 분할/부모 맥락, 큰 문단/목록/원자 블록 오류, CRLF/Unicode/원문 순서 및 전체 coverage, hash 불일치, legacy 교체/재로드.
- UI·local hash 완료 전 파일 삭제/이동/종료·저장 큐 대기 중 무효화 테스트 추가. 기존 Domain, Content Nature, 한국어 Concept, 통합, 사용량, 503, timeout, SecretStorage 회귀 통과.

실제 저장소 Markdown 검사 결과(외부 Gemini 호출 없음):

| 문서 | 줄 | UTF-8 bytes | Sections(root 포함) | Blocks | Contexts | 최대 Context bytes | 원문 coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| PRD-Document-Framer.md | 1,002 | 58,472 | 116 | 381 | 24 | 7,509 | 누락/중복 없음 |
| Project_Brief_Document-Framer.md | 820 | 25,747 | 67 | 272 | 11 | 5,361 | 누락/중복 없음 |
| prompt.md | 1,661 | 26,053 | 70 | 482 | 예산 초과 | — | 로컬 구조 생성 성공, Context 생성 명시적 실패 |

prompt.md는 독립 H1 주제가 32개보다 많다. 주제를 임의로 합치거나 요청 예산을 늘리지 않고 전체 Context 생성을 거부한다. 이는 문서 크기 오류가 아닌 모델 입력 요청 개수 제한이다.

동일한 실문서 검사는 아래 명령으로 재현한다(문서 편집 후 통계는 달라질 수 있다).

```bash
node --import tsx - <<'JS'
const fs = require('fs');
const { StructuralEngine } = require('./src/structure.ts');
const { buildContextUnits } = require('./src/context.ts');
(async () => {
  for (const path of ['Doc/PRD-Document-Framer.md', 'Doc/Project_Brief_Document-Framer.md', 'Doc/prompt.md']) {
    const text = fs.readFileSync(path, 'utf8');
    const frame = await new StructuralEngine().generate({ path, basename: path, ctime: 0, mtime: 0, text });
    try {
      const units = await buildContextUnits(text, frame);
      const ranges = units.flatMap(u => u.sourceRanges);
      const coverage = ranges[0].startOffset === 0 && ranges.at(-1).endOffset === text.length
        && ranges.every((r, i) => !i || ranges[i - 1].endOffset === r.startOffset);
      console.log({ path, lines: frame.document.lineCount, bytes: frame.document.bytes,
        sections: frame.structure.sections.length, blocks: frame.structure.blocks.length,
        contexts: units.length, maxContextBytes: Math.max(...units.map(u => u.byteLength)), coverage });
    } catch (error) { console.log({ path, contextError: error.message }); }
  }
})();
JS
```

## 지원 범위 / Open Decisions

파서는 완전한 CommonMark/YAML 구현이 아니다. ATX 및 한 줄 Setext, 일반/중첩 목록과 lazy continuation, 연속 quote, fenced/indented code, pipe+delimiter GFM table을 지원한다. 닫히지 않은 fence는 EOF까지 코드로 보존한다. 종료 delimiter가 없는 첫 `---`는 수평선으로 해석한다. HTML block 및 복잡한 Markdown container, reference-style 링크/임의 bare URL 통계, YAML 값 해석은 지원하지 않는다. 링크 통계는 코드 밖 inline 링크·angle autolink, source metadata는 정해진 top-level 키 이름의 관찰값이다.

실제 Vault 문서에서 지원하지 않는 문법이 얼마나 필요한지, Context 크기/작은 섹션 임계값이 모델에 적합한지는 후속 평가가 필요하다. 모델 의미 품질 및 실제 Obsidian GUI 검수는 이번 오프라인 테스트로 보장하지 않는다.

## Change Candidates — 미구현

Developer Details의 예상 Context 목록 미리보기, 선택적 Context overlap, 확장 Markdown parser, block-specific 대형 코드/표 분할, 요청 예산 정책 조정은 후속 후보다. Grounding-aware 분류·Content Nature 정확도 개선·새 Human Review·계층적 Concept 통합·candidate budget 확장·AI semantic chunking은 구현하지 않았다.
