# 2단계 구현 기록 · Gemini 분류 미리보기

> 아래 최초 구현 기록의 고정 Domain·v2 저장·프롬프트 v1은 당시 상태다. 현재 정책은 문서 마지막의 Phase 2 revision을 따른다.

2026-09-15. 요구사항 우선순위는 사용자 추가 결정 → PRD → MVP 계획이다. 이번 범위는 설정·저장 통합, 키 관리, 독립 통신, taxonomy/schema, 원문 블록 추출, 실제 분류의 별도 미리보기까지다. 활성 Frame 갱신·자동 실행·사용자 annotation 수정·질문·버전 비교/복구는 연결하지 않는다.

## 모델과 공식 API 확인

- 사용자 요청에 따라 기본 모델을 `gemini-3.1-flash-lite`로 변경했다. [공식 모델 문서](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)를 확인했다. 기존 `gemini-2.5-flash-lite` 설정은 로드 시 새 기본 모델로 이전하고 다음 저장에 반영하며, 키·Frame·과거 호출 기록은 보존한다. 계정별 실제 가용성은 설정의 연결 확인으로 검증한다.
- [GenerateContent REST API](https://ai.google.dev/api/generate-content)와 [해당 API의 structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)를 사용한다. `x-goog-api-key` 헤더, `generationConfig.responseMimeType`과 `responseJsonSchema`를 지정한다. 웹 검색·도구·추가 요약 호출은 없다.
- [Obsidian SecretStorage 안내](https://docs.obsidian.md/plugins/guides/secret-storage)와 [공식 API 선언](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)에 맞춰 Obsidian 1.11.4 이상을 요구한다. 비밀번호 입력 후 `setSecret`으로 전용 ID `document-framer-gemini-api-key`에 저장한다. 기존 키는 입력칸에 되채우지 않는다. 공개 API에 삭제 메서드가 없어 **삭제**는 `setSecret(id, '')`로 비밀 값을 비운다. 빈 항목 이름은 남을 수 있다. 평문 파일 fallback은 없다. `.env`는 읽거나 빌드 입력으로 사용하지 않는다.

## 저장과 요청 흐름

- `src/storage.ts`: `data.json` v2는 `{ version, settings: { model, secretId }, frames, attempts }`다. 기존 v1/v2의 `attempts` 누락은 빈 기록으로 읽는다. v1 Frame을 변형 없이 로드하며 첫 정상 저장 때 이전한다. 설정·Frame·호출 기록 쓰기를 직렬화한다. 읽기 불가/지원하지 않는 버전은 덮어쓰지 않는다.
- 키 값은 공식 비밀 저장소에만 남는다. 설정 저장에는 키가 들어가지 않는다. 설정 파일 저장과 비밀 값 저장은 별개 작업이므로 실패 시 설정 화면에서 재시도한다.
- 기존 수동 테스트 엔진과 저장 흐름을 유지한다. Gemini에는 별도 수동 요청·고정 60초 안정 대기를 적용한다. 관찰/저장만으로 API를 호출하지 않는다.
- `src/gemini.ts`: Obsidian과 분리된 비동기 클라이언트에 HTTP transport를 주입한다. 플러그인은 공식 `requestUrl`을 사용한다. 연결 확인과 분류가 동일한 잠금을 공유한다. 동시 호출은 1개이며, 이미 진행 중이면 추가 호출을 거부하고 다시 요청하도록 안내한다.
- 기본 1회 호출. 네트워크 실패와 HTTP 408/500/502/503/504만 1초 후 최대 1회 재시도한다. 400/401/403/404/429, JSON/schema 실패, 차단·출력 잘림은 재시도하지 않는다. 특히 429는 일시 제한과 사용량 소진을 확실히 구분하지 못하므로 계정 확인을 안내한다. [Gemini 오류 안내](https://ai.google.dev/gemini-api/docs/troubleshooting) 참고.
- 총 응답 대기 60초, 출력 최대 8192 tokens, thinking level `minimal`·temperature 1을 **미리보기용 제안**으로 적용한다. `requestUrl`에는 취소 API가 없으므로 시간 초과 후에도 같은 세션에서는 실제 HTTP가 끝날 때까지 잠금을 유지한다. 재시작 후 미해결 기록은 표시하며 자동 재전송하지 않는다. 설정의 **중복 처리·과금 가능성을 확인하고 새 요청 허용**을 누른 뒤 사용자가 새 요청을 직접 선택할 수 있다. 확인은 이전 요청의 해결·취소를 뜻하지 않는다. 미해결 기록이 남은 채 다시 재시작하면 다시 확인한다.
- 오류에는 키·원문·서버 응답 본문·전송 예외 내용을 출력하지 않는다. 유료/다른 모델 전환은 없다. 기본 모델 자체의 요금 발생 가능성은 설정과 요청 화면에 표시한다.

## Taxonomy 초안: `draft-0.1` (제안, 미확정)

| 구분 | 제안 |
| --- | --- |
| Domain | `engineering`: Engineering; `computing`: Engineering → Computer Science; `ai`: Engineering → Computer Science → Artificial Intelligence; `science`: Science; `business`: Business; `personal`: Personal; `other`: Other |
| Type | `informational`: 주장·근거·결론형 정보; `idea-note`: 아이디어/메모; `prose-with-decision`: 중요 결정이 있는 산문; `prose-without-decision`: 중요 결정이 없는 산문 |
| Label | `claim`, `evidence`, `conclusion`, `idea`, `observation`, `decision`, `context` |
| 미분류 | Type/Label의 `unclassified`는 의미 분류 불가 표현. Domain이 맞지 않으면 `other` 단독 사용 |
| Confidence | Domain·Type·각 Label별 0~1 모델 자기 평가. 품질 보증/사실 확률이 아니며 자동 처리 임계값 없음 |

Domain/Label은 여러 개를 허용한다. 이번 초안은 Type별 Label 제한을 두지 않는다. 확정 taxonomy, Type별 하위 Label, 품질 합격 기준과 실제 분류 품질 실험은 미결정이다. 자동 테스트의 가짜 응답은 분류 품질의 근거가 아니다.

## Schema와 원문 위치

모델 응답 예시 (`src/classification.ts`에 JSON schema와 로컬 검증 구현):

```json
{
  "domains": [{ "id": "other", "confidence": 0.3 }],
  "type": { "id": "idea-note", "confidence": 0.7 },
  "units": [{ "blockIds": ["b1", "b2"], "labels": [{ "id": "idea", "confidence": 0.6 }] }]
}
```

알 수 없는 필드/분류, 중복 annotation, 비정상 confidence, 빈 Unit/Label, 블록 누락·중복·역순·없는 ID를 거부한다. `other`와 알려진 Domain 또는 `unclassified`와 다른 Label을 섞지 않는다. 낮은 confidence 자체는 거부하지 않는다. 검증 실패 시 결과를 미리보기에 반영하지 않는다.

`src/blocks.ts`는 원문을 정규화하지 않고 heading·빈 줄 경계의 텍스트·fenced code·선두 frontmatter를 추출한다. 목록/인용/표는 인접 텍스트 블록으로 보존한다. 완전한 CommonMark AST나 문장 단위 분할기는 아니다. 블록을 의미 단위로 묶는 작업은 모델이 연속된 ID를 선택하여 수행한다. 블록 안을 모델이 다시 자르지는 않는다.

줄 번호는 1부터 시작하며 끝 행을 포함한다. offset은 JavaScript UTF-16 기준 `[startOffset, endOffset)`이다. CRLF·한글·emoji를 포함하여 `sourceText.slice(startOffset, endOffset)`로 요청 당시 원문을 복원한다. 경계의 빈 줄은 블록 ID가 없지만 원문 snapshot에 보존된다. 프런트매터와 코드도 전송되는 문서 텍스트에 포함된다. 파일 경로·시각·계산된 metadata와 위치는 보내지 않는다.

`src/framing.ts`가 로컬 metadata와 검증된 annotation을 합쳐 `schemaVersion: 2`, `previewOnly: true` Frame을 만든다. 입력은 **64 KiB·128블록 이하**라는 비용/출력 한도 제안을 적용하며 초과 시 무음 절단이나 자동 분할 호출을 하지 않는다. 미리보기는 원문 snapshot과 함께 메모리에만 보관하고 기존 활성 Frame을 바꾸지 않는다. 호출 기록은 독립적으로 저장한다. 원문 편집 후에도 요청 당시 결과임을 명시하며 최신 여부의 자동 판정은 후속 단계다.

## 5개 문서 초기 평가를 위한 추가 구현

- 삭제·이동 시 요청 세대를 무효화하고 응답 반영 직전에 파일 객체·경로·세대를 확인한다. 같은 경로의 새 파일, 이동 후 복귀, 폴더 이동도 이전 성공/실패 상태를 되살리지 않는다. 무효 요청의 재시도도 중단하며 도착한 사용량은 기록한다.
- `src/attempts.ts`: 실행 ID와 시도 번호로 `attempts`를 갱신한다. 연결 확인과 분류, 최초 호출과 재시도를 구분한다. HTTP 전송 전에 기록 저장을 완료하며 실패하면 전송하지 않는다. 기록 저장 직후 앱이 종료되는 경계에서는 실제 전송 여부도 미확인일 수 있다.
- 응답의 `usageMetadata`를 분류 검증보다 먼저 읽는다. 입력·출력·총 토큰 및 캐시·생각·도구 토큰은 제공된 숫자만 기록하며 누락/비정상 값은 `null`이다. 미확인을 0으로 계산하지 않고 비용 환산은 하지 않는다. 연결 확인은 문서 분류 실행과 분리한다. [공식 응답 필드](https://ai.google.dev/api/generate-content#UsageMetadata)를 따른다.
- timeout은 같은 시도에 시각을 기록하고, 늦은 응답은 그 ID의 사용량·모델·종료·지연 정보를 한 번 갱신한다. `durationMs`는 HTTP 전송부터 로컬 응답/오류까지의 시간이며, 미종료는 `null`이다. 로컬 네트워크 오류도 원격 처리·과금 없음의 증거가 아니다. 종료된 플러그인 인스턴스의 콜백은 새 세션의 저장소를 덮어쓰지 않으며 해당 미해결 기록은 미확인으로 남는다.
- 기록 저장 실패는 표시하고 최신 기록은 메모리에 보존한다. 다음 기록 저장 성공 시 현재 기록을 함께 저장한다. 저장하지 못한 최신 내용은 앱 종료로 잃을 수 있으므로 호출 기록 화면에서 확인한다.
- `src/evaluation.ts`: 정규화하지 않은 UTF-8 원문의 SHA-256, UUID 실행 ID, 프롬프트 `classification-v1`, taxonomy `draft-0.1`, 분할 `markdown-blocks-v1`, schema `classification-schema-v1`, 생성 설정, 응답 `modelVersion`을 기록한다. 원문·키·서버 본문은 호출 기록에 넣지 않는다. 프롬프트/schema 내용은 해당 버전의 소스로 확인한다. 해시는 파일 동일성을 보장하지 않는다.
- 설정과 문서 요청 화면에 무상 API 데이터 이용 안내를 보완했다. 제품·머신러닝 개선과 사람 검토 가능성, 민감·기밀·개인정보 제출 금지, 유료 서비스의 제한적 보관, 활성 결제 프로젝트 기준 및 EEA·스위스·영국 예외를 [공식 약관](https://ai.google.dev/gemini-api/terms)에 따라 안내한다(확인: 2026-09-15). 키나 연결 성공으로 요금제·적용 조건을 추정하지 않는다.
- **Gemini 호출 기록·복구 보기** 명령 또는 설정의 **기록 보기**에서 실행/시도별 사용량·지연과 추적 JSON을 확인한다. 실제 문서 평가는 수동으로 수행한다. taxonomy 확장·블록 분할 변경·실제 Frame 저장 연결·F1 등 수치 합격 기준 확정은 포함하지 않는다.

## 검증과 사용자 확인

- `npm test`: 외부 API 없이 기존 흐름·마이그레이션·직렬 저장/실패·키 UI/삭제/재로드·연결 확인·동시 호출/timeout/재시도·응답 검증·블록 위치·미리보기 격리를 검증한다.
- `npm run build`: TypeScript 검사와 번들 생성. `npm run test:vault`: 실제 확인용 Vault의 플러그인 파일 갱신.
- 실제 Obsidian과 Gemini 계정 확인 순서는 [README](../README.md#gemini-미리보기-확인)에 있다. 자동 테스트에서는 외부 API를 호출하지 않았으며 실계정 성공을 주장하지 않는다.

모델 변경 시 [Gemini 3 공식 안내](https://ai.google.dev/gemini-api/docs/generate-content/gemini-3)에 맞춰 `thinkingBudget` 대신 `thinkingLevel: minimal`을 사용하고 권장 temperature 1을 적용했다. `minimal`은 생각 토큰 0을 보장하지 않으며 사용량 기록은 계속 실제 응답값을 따른다.


## Phase 2 revision / follow-up — Domain Catalog & Review (2026-09-15)

### 확정 구현 계약

- 사용자 prompt.md가 기존 고정 Domain/Other fallback 결정을 대체한다. PRD/Brief/Plan을 먼저 조정한 뒤 구현한다.
- Domain 응답은 `{ path: string[], source: 'existing' | 'new' | 'unclassified', confidence: number }`. 경로는 1~3단계, 단계당 1~80 UTF-16 코드 단위. NFC·앞뒤 공백 없음·내부 공백 한 칸·제어/비표시 형식 문자 없음으로 제한한다. 비정규 표기를 조용히 고치지 않고 거부한다.
- 동일성 키는 NFC 경로 각 요소의 locale-independent 소문자 표현이다. 대소문자만 다른 새 후보와 중복을 거부하며 existing은 저장된 정확한 경로 표기를 요구한다. 경로 내부 반복 단계도 거부한다. 동의어/번역/의미상 상하 관계 판정은 모델과 사용자 검토의 책임이다.
- Other는 `path: ['Other'], source: 'unclassified'` 단독으로만 허용한다. 의미 판단 불가 표시로 예약하며 Catalog 등록 대상이 아니다. new/existing과 혼합하지 않는다.
- data.json v3: 기존 settings/frames/attempts와 `domains: {path: string[]}[]`. 빈 Catalog로 시작하고 승인된 전체 경로만 추가한다. 상위 경로를 별도 항목으로 자동 생성하지 않는다. v1/v2는 빈 Catalog와 함께 복원하고 첫 저장에서 v3로 이전한다. 기존 Frame과 과거 시도는 재분류·변형하지 않는다.
- Catalog는 이번 slice에서 추가만 가능하다. 프레이머는 요청 시작 시 복사한 Catalog를 입력과 응답 검증에 동일하게 사용한다. 연결 검사도 승인 Catalog를 사용한다.
- `classification-v2`, `classification-schema-v2`, `domain-policy-v1/type-label-draft-0.1`로 버전 의미를 구분한다. taxonomyVersion은 고정 Domain 목록이 아니라 Domain 규칙과 Type/Label 초안의 버전이다.
- Evaluation Trace는 `domainCatalogHash`(JSON 경로 배열 스냅샷의 SHA-256), `domainCatalogCount`, `domainCatalogEncoding: catalog-json-v1`을 기록한다. 추가 순서를 유지하므로 현재 Catalog의 첫 count개와 해시로 과거 입력을 재구성·검증할 수 있다. 외부 편집/삭제 시 재구성을 보장하지 않는다. 전체 Catalog를 매 Attempt에 복제하지 않는다. 과거 v1 trace는 그대로 보존한다.
- 후보는 미리보기에서 명시적으로 승인/거절한다. 승인 저장 성공만 Catalog에 반영하며 실패 시 재시도할 수 있다. 거절/미응답은 메모리 상태이고 재시작하면 사라진다. 승인으로 원래 AI 출처나 confidence를 바꾸지 않으며 활성 Frame을 게시하지 않는다.
- 교체/삭제/이동/종료된 미리보기의 새 승인 요청은 거부한다. 여러 창/동시 승인 시 동일 경로는 한 항목으로 저장한다.
- Review는 분야·출처·Type·Unit/행 범위·Label·원문을 표시한다. JSON·confidence·모델·run ID·평가 버전은 닫힌 Developer Details 안에 둔다. Attempt Journal 화면은 유지한다.

### 유지 범위와 미결정 사항

원문 Source of Truth, derived Frame, multi-domain/3단계, Type/Label/블록 위치, 64 KiB·128블록, 호출 제한·retry·timeout·Attempt Journal·SecretStorage, temperature 1·thinking minimal을 유지한다. 전체 Human Correction, 활성 Frame publication, Reframing, 자동 실행은 구현하지 않는다.

실제 재사용 품질과 신규 분야 세분화 억제의 합격 기준, 동의어·다국어 표기, Catalog가 커질 때 입력 비용 정책은 Open Decision이다. 테스트용 모델 응답은 실제 Gemini 분류 품질을 증명하지 않는다.

Change Candidates (이번 구현 제외): 사용자 Catalog 이름 변경/삭제와 과거 스냅샷 보존 정책, 거절 후보의 세션 간 보존·재제안 제어. 자동 병합·embedding·추가 LLM 정제 호출은 추가하지 않는다.


### Revision 검증 및 reconciliation 결과

- `npm run build`: TypeScript 검사와 CommonJS 번들 생성 성공.
- `npm test`: **49 passed, 0 failed**. 기존 37개 테스트의 계약/표시 기대값을 갱신하고 12개 테스트를 추가했다. 샌드박스의 tsx IPC 소켓 제한으로 테스트는 승인된 제한 밖 실행을 사용했다.
- `git diff --check`: 통과.
- AC-A/B: 기존 경로 수용·신규 3단계/multi-domain·프롬프트 재사용 지침을 오프라인 검증했다. Economics/행동경제학의 실제 의미 품질은 README 수동 평가 절차로 남긴다.
- AC-C/D: UI 승인 → v3 저장 → 재시작 → 다음 입력 전달, 거절·미응답 제외를 검증했다.
- AC-E: 허위 existing, 표기/정규화/계층/중복/예약값 오류를 거부하고 이전 미리보기를 유지한다.
- AC-F/G: 기본 화면의 Domain·출처·Type·Unit·Label·원문과 닫힌 Developer Details의 confidence/JSON/평가 정보 분리를 UI 모형으로 검증했다.
- AC-H: 원문 위치·retry/timeout·usage journal·SecretStorage·파일 세대 무효화 회귀가 통과했다. transport/Attempt Journal/블록 추출기와 generation configuration은 유지했다.
- PRD 0.5, Brief, MVP Plan, README를 현재 구현과 대조했다. 이 문서 앞부분은 기존 구현 이력으로 보존했다. 실제 Obsidian 화면 수동 검수와 실제 Gemini 호출은 이번 작업에서 실행하지 않았다.


## 2R 설계 — Concept-based Framing (2026-09-16 새 사용자 결정)

이 문서 앞부분의 partition/64 KiB/128블록/Frame 3 및 49개 테스트는 이전 구현 이력이다. 현재 요구사항은 PRD 0.6의 2R 계약이다.

Frame 4는 document와 concepts를 가지며 각 Concept은 여러 EvidenceSpan과 highlight를 가진다. Evidence 문자열은 모델에서 받지 않고 blockIds를 원문 offset으로 변환한다. labels는 Evidence의 역할이다. data.json v3와 기존 Frame은 그대로 유지한다.

파이프라인: 입력 사전 검증 → 구조 청크 전체 계획 → 청크별 concepts/Domain/Type 추출 → 정규화 이름 중복 로컬 병합 → 필요 시 이름/ID만으로 의미 통합 → 청크 신호로 문서 Domain/Type 집계 → 모두 성공한 미리보기만 반환. 한 청크는 document 분류를 추출에 함께 받아 추가 호출하지 않는다. 의미 통합은 다른 청크 사이에 비동일 이름이 남았을 때만 최대 한 번 사용한다. 모든 다른 이름이 동의어인지 로컬에서 증명할 수 없으므로 이때 한 번 비교하며, 모델은 다른 개념은 singleton으로 유지해야 한다.

예산: 512 KiB 문서, 32청크, 청크당 16 KiB/64블록, 작은 섹션 병합 기준 2 KiB, 청크당 16개 Concept/문서당 128개 원시 후보, 모델 입력 JSON 96 KiB, 문서 집계 1회·통합 1회, 최대 논리 호출 34회/HTTP 68회. 이는 API 최대치가 아니라 테스트 가능한 MVP 비용 상한이다. 설정값은 budget.ts에서 관리한다. 모델 품질/토큰 적합성은 실제 평가로 조정한다.

Trace는 기존 purpose와 호출별 runId를 보존하고 framingRunId/stage/chunkId로 연결한다. 원문 hash·chunker/prompt/schema/consolidation 버전·Catalog hash·각 실제 입력 hash·생성 설정을 남긴다. 원문 전체를 Attempt log에 복제하지 않는다.

Highlight는 미리보기의 사용자 선택이며 메모리에서만 유지한다. 전체 Human Correction과 사용자 annotation 영구 보존·Clarification·자동 실행·Safe Reframing은 구현하지 않는다.

2R 청크 계획 보완: 작은 Heading이 많아 32청크를 넘으면 인접 섹션을 16 KiB/64블록까지 다시 묶는다. 두 계획 모두 실패한 경우에만 입력 청크 예산 초과로 처리한다.

### 2R 구현 결과와 검증

- `src/budget.ts`: 문서·청크·후보·호출 예산 상수와 입력 크기 검사.
- `src/chunks.ts`: Heading/블록 우선 청크, 과대 블록의 줄/Unicode 경계 분할, 작은 섹션 재묶기, 전체 원문 위치 유지.
- `src/concept-prompts.ts`: 개념 추출 및 이름/후보 ID 기반 통합 프롬프트. `classification-prompt.ts`는 Document Domain/Type 집계 역할이다.
- `src/concepts.ts`: Concept/Evidence schema와 검증, 정확한 이름의 로컬 병합, 의미 통합 후보 보존 검사. 근거 중복은 블록 단위로 정리하고 인접·동일 Label 블록을 다시 묶는다. 같은 Label의 confidence는 최솟값을 유지하며 구체적 역할이 있으면 unclassified를 제외한다.
- `src/classification.ts`: Domain/Type 계약으로 한정했다. 기존 Domain 경로/출처 검증 규칙은 유지한다.
- `src/framing.ts`: 순차 파이프라인, 문서 실행 잠금, 호출 전 예산·유효성 확인, 진행 상태, 전체 완료 후 Frame 4 반환. 실패한 중간 후보는 정상 미리보기로 반환하지 않는다.
- `src/evaluation.ts`/`src/attempts.ts`: 호출별 trace 연결과 단계/청크의 Journal 표시. 기존 저장 이력 로드 및 사용량 기록 방식은 유지한다.
- `src/main.ts`/`src/settings.ts`: Concept/Evidence Review, 메모리 Highlight, 청크 진행과 요청 예산 안내. Domain 승인 UI와 Developer Details 분리는 유지한다.

검증(2026-09-16):

- `npm run build`: 성공, TypeScript 검사와 `main.js` 생성.
- `npm test`: **67 passed, 0 failed**. tsx IPC 소켓 제약 때문에 승인된 sandbox 밖에서 실행했다.
- `git diff --check`: 통과.
- `git diff --exit-code -- src/gemini.ts src/storage.ts src/domains.ts src/blocks.ts src/core.ts`: 변경 없음 확인. 생성 설정은 EvaluationTrace의 타입 확장과 별개로 그대로 유지했다.
- 기존 49개 테스트 중 partition 전체 배분 검증을 새 선택적 Evidence 검증과 Domain 테스트로 재구성하여 기존 파일은 48개가 되었고, `tests/concepts.test.ts` 16개 및 플러그인 UI/실패 보존 3개를 추가하여 총 67개다.
- 요청문 Test A/B/C/F: 미선택 원문·비연속 Evidence·0개 Concept·가짜 ID/요약/임의 offset 거부를 검증했다.
- Test D/E: 서로 다른 청크의 의미 병합과 정규화 이름의 무호출 병합, 후보 누락/중복/위조 거부를 검증했다.
- Test G/H/I: 64 KiB 및 128블록 초과, 실제 repository PRD와 문서형 입력, 예산 초과, 청크/통합/문서분류 실패, 최대 34개 논리 호출/68 HTTP 시도를 검증했다.
- Test J: Domain 승인/재시작/재사용, retry/timeout/늦은 사용량, SecretStorage, 원문/기존 Frame 보존 회귀가 통과했다. 새 trace도 data.json v3에서 복원된다.

### 남은 Open Decisions

- 실제 Gemini에서 개념의 재사용 가치·선택적 근거 적합성·의미 통합의 과병합/미병합을 평가할 기준과 corpus.
- 청크 크기/Concept 수/출력 토큰 예산의 실사용 품질·비용 조정. 현재 값은 API 한도를 검증한 최대값이 아니라 MVP의 내부 상한이다.
- 긴 문서의 최종 Domain/Type은 원문을 다시 보내지 않고 청크 신호를 집계한다. 그 과정의 분류 편향과 개념 이름만 사용한 동의어 판정은 실제 평가가 필요하다.
- Safe Reframing에서 Concept/Evidence ID 대응, 사용자 이름/연결/Label/Highlight 영구 보존 정책. 현재 Highlight는 메모리 전용이다.

### Change Candidates — 이번 구현 제외

- 결정론적 문장 단위 Evidence 분할 및 대형 코드 블록 맥락 개선.
- 실패 청크의 재시작 후 재개/중간 캐시 및 실행별 사용량 합계 UI.
- Concept 통합 판단의 사용자 검토·되돌리기. 의미 유사도 DB·embedding·RAG·Concept graph는 도입하지 않았다.

실제 외부 Gemini 호출 및 Obsidian GUI 수동 검수는 이번 자동 검증에 포함하지 않았다. 사용 절차와 평가 항목은 README의 2R 항목에 정리했다. PRD/Brief/Plan의 현재 제품 정의를 Concept/Evidence로 정리했으며, 이 문서 앞부분의 이전 구현 기록은 역사적으로 보존했다.
