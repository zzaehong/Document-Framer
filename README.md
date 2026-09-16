# Document Framer

Obsidian Markdown 원문을 보존하고 별도 Frame을 만드는 플러그인입니다. [MVP 계획](Doc/MVP_plan.md)의 **1단계 수동 테스트 흐름**과 **2단계 Gemini 미리보기와 2S Framing Core 단순화**을 구현했습니다. 실제 분류 결과의 활성 Frame 반영은 후속 범위입니다.

## 바로 테스트하기

Node.js 22 이상, Obsidian 1.11.4 이상에서:

```bash
npm ci
npm test
npm run test:vault
```

1. Obsidian의 **보관함 관리 → 폴더를 보관함으로 열기**에서 이 프로젝트의 `.test-vault` 폴더를 선택합니다. 숨김 폴더가 보이지 않으면 전체 경로를 입력합니다.
2. 설정 → 커뮤니티 플러그인에서 제한 모드를 해제하고 **Document Framer**를 활성화합니다.
3. `시작하기.md`를 열고 왼쪽 리본의 **현재 문서 Framing** 아이콘 또는 명령 팔레트의 **Document Framer: 현재 문서 Framing 요청**을 실행합니다.
4. 오른쪽 패널에서 대기 상태와 저장된 결과를 확인합니다. 로컬 테스트 JSON은 접힌 Developer Details에서 볼 수 있습니다. 패널의 **현재 문서 Framing** 버튼으로도 요청할 수 있습니다.

마지막 원문 변경 후 60초가 지나야 실행됩니다. 이미 60초 이상 지난 문서는 바로 실행됩니다. 새로 한 글자를 입력하고 버튼을 누르면 대기 흐름을 볼 수 있습니다. 대기 중 편집하면 다시 60초를 계산하고, 같은 내용의 저장은 대기를 늘리지 않습니다. 문서 열기나 저장만으로는 실행되지 않습니다. API 키와 네트워크 연결은 필요 없습니다.

`npm run test:vault`를 다시 실행하면 플러그인 빌드를 갱신하며 기존 테스트 문서와 Frame은 보존합니다. Obsidian에서 플러그인을 껐다 켜면 새 빌드가 적용됩니다.

## Gemini 미리보기 확인

1. 설정 → **Document Framer**에서 Gemini API 키를 입력하고 **저장**합니다. 키는 Obsidian 공식 `SecretStorage`의 전용 항목에 저장됩니다. `.env`는 읽지 않으며 번들에 포함하지 않습니다.
2. **연결 확인**을 누릅니다. 짧은 고정 문장으로 `gemini-3.1-flash-lite`의 실제 분류 응답까지 확인합니다. 문서 내용은 연결 확인에 사용하지 않습니다.
3. 문서를 열고 명령 팔레트의 **Gemini Framing 미리보기 요청** 또는 오른쪽 패널의 같은 버튼을 누릅니다. 문서 텍스트가 Google Gemini로 전송되며 API 이용 요금이 발생할 수 있습니다.
4. 마지막 편집 후 60초가 지나면 분류합니다. **최근 Gemini 미리보기 열기**에서 Domain 경로·기존/신규 여부·한국어 Content Nature·Key Concept·중요 표시을 검토합니다. confidence와 Frame JSON·모델·실행/버전 정보는 접힌 **Developer Details**에 있습니다.
5. 새 Domain 후보에서 **승인**하면 Catalog에 저장되어 다음 요청부터 기존 분야로 전달됩니다. **거절**하거나 승인하지 않은 후보는 저장되지 않습니다. 원문과 기존 저장 Frame은 유지됩니다. 미리보기와 거절 상태는 요청 당시 원문 기준이며 메모리에만 남아 재시작하면 사라집니다. 승인한 Catalog는 재시작해도 유지됩니다.
6. 설정의 **삭제**를 누르고 플러그인을 다시 켜서 키가 없는 상태인지 확인합니다. 삭제는 전용 비밀 항목의 값을 비우며 Google에서 발급한 키 자체를 폐기하지는 않습니다.

평가 시 **Gemini 호출 기록·복구 보기**에서 문서/실행 ID, 시도별 입력·출력·총 토큰, 지연과 추적 JSON을 확인합니다. 사용량 미확인은 0이 아니며 비용은 환산하지 않습니다. 무상 API의 데이터 이용 조건을 설정에서 확인하고 비민감 문서만 사용하세요.

시간 초과 후 같은 세션에서는 실제 HTTP 종료까지 새 호출을 막습니다. 재시작 후에는 미해결 기록을 표시하며 자동 재전송하지 않습니다. 설정에서 **중복 처리·과금 가능성을 확인하고 새 요청 허용**을 누른 뒤 새 요청을 직접 선택할 수 있습니다. 로컬 종료나 확인 버튼은 원격 취소를 뜻하지 않습니다.

짧은 문서는 1회 추출하고, 긴 문서는 구조 청크를 순서대로 처리합니다. 동시 HTTP 호출은 1개, 논리 호출별 일시 오류 재시도는 최대 2회입니다. 인증·사용량 오류나 응답 검증 실패는 자동 재시도하지 않습니다. 다른 모델로 자동 전환하지 않습니다. 현재 문서 예산은 512 KiB·32청크이며 청크당 16 KiB·64블록입니다. 최대 34회 요청(재시도 포함 102회 전송)이며 한도를 넘거나 중간 단계가 실패하면 전체 미리보기를 완료로 표시하지 않습니다. 세부 제안·제약과 공식 API 근거는 [2단계 구현 기록](Doc/MVP_phase2.md)을 참고하세요.

## 기존 Vault에 설치

`npm run build` 후 다음 세 파일을 `<Vault>/.obsidian/plugins/document-framer/`에 복사하고 플러그인을 활성화합니다.

- `main.js`
- `manifest.json`
- `styles.css`

이는 [Obsidian 공식 샘플 플러그인의 수동 설치 방식](https://github.com/obsidianmd/obsidian-sample-plugin)을 따릅니다. 개발 중에는 `npm run dev`로 자동 빌드할 수 있으며, 테스트 Vault에는 다시 복사하고 플러그인을 재시작해야 합니다.

## 구현 범위와 저장

- Markdown 읽기: 활성 편집기의 현재 내용 우선, 그 외 Vault 읽기 API 사용.
- 고정 60초 안정 대기와 문서별 수동 요청. 중복 클릭 병합, 실행 후 요청 소비.
- 기계적 metadata: 경로, H1 또는 파일명 제목, 파일 생성·수정 시각(ms), UTF-8 바이트 수, 줄 수, ATX heading 목록(코드 블록 제외).
- 테스트 엔진: 문서 전체를 하나의 테스트 Unit으로 표현. `engine: local-test-v1`, `TEST_ONLY` 라벨. 실제 Domain/Content Nature/Confidence는 빈 배열 또는 null로 표시.
- 저장 위치: `<Vault 설정 폴더>/plugins/document-framer/data.json`. `version: 3`에 설정(모델·비밀 항목 ID), 기존 Frame, 독립적인 호출 시도 기록과 승인 Domain Catalog(`domains`)를 저장합니다. 키 값은 포함하지 않습니다. 기존 `version: 1/2`는 Frame과 과거 호출 기록을 보존하고 빈 Catalog로 읽으며 다음 저장 시 v3로 이전합니다. 고정 분야 목록을 자동 등록하거나 기존 Frame을 재분류하지 않습니다. 원문을 수정하지 않으며 재시작 후 **Frame 보기** 명령으로 다시 조회 가능합니다.
- 빈 문서와 2 MiB 초과 입력은 오류 표시. 저장 실패 시 기존 메모리 결과를 유지하고 수동 재시도 가능.

실제 AI 분류·원문 언어 Concept 추출·청크 간 통합은 별도 미리보기까지 구현했습니다. 안전한 원문 버전 비교와 저장 복구는 3단계, 자동 실행·60→240초 가변 대기는 4단계입니다. Document 중요도와 Concept Highlight 영구 저장, 질문, 파일 이동 시 Frame 연결 복구와 미완료 요청 복구도 후속 단계입니다. 현재 Frame 키는 파일 경로이며 대기 요청은 재시작하면 사라집니다. 표시 결과는 요청 당시 결과로, 원문 수정 후에는 다시 요청해야 합니다. metadata의 수정 시각은 파일 저장 시각이며 아직 저장되지 않은 편집 시각과 다를 수 있습니다.

## 검증

`npm test`는 외부 API를 호출하지 않습니다. 가상 시계로 60초 경계·대기 초기화·중복 요청·문서별 격리를 검증하며, Obsidian/HTTP 모형으로 저장 호환·설정 UI·키 삭제·연결 확인·미리보기 격리·재시도·응답 검증·원문 위치를 확인합니다. `npm run build`는 TypeScript 검사와 Obsidian용 CommonJS 번들을 생성합니다. 실제 Obsidian 화면 동작은 위 테스트 Vault에서 아래 순서로 확인합니다.

1. 편집 직후 요청 → 카운트다운 → 저장 완료.
2. 대기 중 편집 → 남은 시간이 다시 60초.
3. 원문을 비교해 자동 수정이 없음을 확인.
4. 플러그인을 껐다 켜고 **Frame 보기** → 기존 결과 확인.
5. 두 번째 문서 열기만으로 처리되지 않음 → 수동 요청하면 해당 문서 결과 생성.
6. 공백만 있는 문서 요청 → 내용 없음 메시지, Frame 생성 안 됨.


## Domain Catalog와 Prompt 수정

- [classification-prompt.ts](src/classification-prompt.ts): 사람이 수정하는 모델 지침과 `PROMPT_VERSION`. [classification.ts](src/classification.ts)는 응답 schema와 로컬 검증을 담당합니다.
- 승인된 경로 중 문서를 합리적으로 표현하는 분야를 우선 재사용합니다. 예를 들어 Economics가 있으면 행동경제학 문서에도 Economics를 사용하도록 지시합니다. 부족할 때만 다른 문서에도 쓸 수 있는 새 후보를 제안합니다.
- 응답 경로는 1~3단계이며 multi-domain을 유지합니다. source는 `existing`, `new`, 또는 의미 판단 불가인 `unclassified`입니다. Other는 마지막 경우의 예약 표시이며 Catalog가 비었다는 이유로 사용하지 않습니다.
- 실제 Catalog에 없는 existing, 대소문자만 바꾼 new, 빈/과도한 길이/중복/잘못된 계층은 거부합니다. 이름의 NFC·공백·대소문자 계약은 [Phase 2 revision](Doc/MVP_phase2.md#phase-2-revision--follow-up--domain-catalog--review-2026-09-15)에 있습니다.
- 승인은 후보 하나를 Catalog에 추가하는 동작입니다. 전체 Frame 수용이나 classification 수정 기능은 아닙니다. 저장에 실패하면 미승인 상태를 유지하며 다시 시도할 수 있습니다.
- 요청에는 `existingDomains`와 `blocks`를 전달합니다. 평가 기록에는 Catalog 전체 대신 해시·개수를 기록하고, 추가 전용 Catalog의 첫 N개 항목으로 당시 스냅샷을 검증할 수 있습니다. 문서 분류 프롬프트/응답 버전은 `document-classification-v4` / `document-classification-schema-v4`, 개념 추출은 `concept-extraction-v2` / `concept-extraction-schema-v2`, AI 미리보기 Frame은 `schemaVersion: 5`입니다. 로컬 저장 Frame의 schemaVersion 1은 유지합니다.

### Domain 변경 수동 검수

1. 비민감 경제학 노트로 Gemini 미리보기를 요청합니다. 빈 Catalog에서도 Economics와 같은 후보가 제안되는지 확인합니다. 실제 출력은 모델에 따라 달라질 수 있습니다.
2. 승인 전 다른 노트를 요청하여 미승인 분야가 기존 분야로 전달되지 않는지 평가합니다. 거절한 후보도 동일합니다.
3. 후보를 승인하고 플러그인을 재시작합니다. 행동경제학 노트를 요청하여 Economics를 재사용하고 불필요하게 세분화하지 않는지 검토합니다.
4. Domain·출처·한국어 Content Nature·Concept 이름·Highlight이 기본 화면에 보이고, JSON/confidence/실행 정보는 Developer Details를 열어야 보이는지 확인합니다.
5. 원문과 기존 로컬 Frame이 보존되는지 확인합니다. 여러 분야와 3단계 경로도 표시할 수 있습니다.

오프라인 테스트는 Catalog 전달·검증·승인·저장·UI 계약을 검증합니다. 위 의미상 재사용 품질과 실제 Obsidian/Gemini 동작은 별도 수동 평가 대상입니다. generation configuration과 timeout 안전성은 유지하며 retry와 문서 처리 예산은 아래 2S 규칙을 사용합니다.


## 2S — Domain, Content Nature, Key Concepts

Framing은 문서가 속한 지식 영역(Domain), 글의 성격(Content Nature), 핵심 개념(Key Concepts)을 나타내는 최소 semantic metadata를 생성합니다. Concept은 문서 전체를 가리키는 색인이며 원문 구간·역할 라벨·요약문을 저장하지 않습니다. 2R에서 시험한 Evidence 연결은 복잡도와 실사용 품질 문제로 제거했습니다.

Content Nature는 `information` → **정보**, `opinion` → **의견**, `mixed` → **정보 + 의견**, `unclassified` → **분류 어려움**입니다. 정보와 의견이 모두 핵심일 때만 mixed를 사용하며 짧은 감상이나 사실 인용만으로 mixed를 선택하지 않도록 지시합니다.

개념 이름은 원문 표현을 우선합니다. 한국어 용어를 영어로 바꾸지 않고, 원문의 영어 전문용어나 `자본자산 가격결정 모형(CAPM)` 같은 표기도 보존합니다. 새 이름이 필요하면 원문의 주 언어를 사용합니다. 이는 모델 지침이며 실제 의미 품질은 별도 평가합니다.

```text
Markdown → 구조 청크 → 청크별 개념/성격 추출
         → 동일 이름 로컬 병합 → 필요한 청크 간 의미 통합
         → 문서 Domain/Content Nature 집계 → Concept Frame 미리보기
```

- Heading/문단 경계를 먼저 사용하고 큰 단일 블록은 줄 경계로 분할합니다. 긴 한 줄은 Unicode 문자 경계로 나눕니다. 작은 섹션은 인접 섹션과 합치며, 섹션 수가 예산을 넘으면 크기·블록 상한까지 다시 묶습니다.
- 한 청크에는 Domain/Content Nature 판단도 함께 요청합니다. 여러 청크 문서는 모든 청크의 분류 신호·개념 이름·본문 크기로 최종 문서 분류를 한 번 결정합니다. 이 집계에는 원문 전체를 재전송하지 않습니다.
- 동일 NFC/대소문자/공백 정규화 이름은 로컬에서 병합합니다. 청크 간 비동일 이름이 남으면 후보 이름·ID·청크 ID만으로 한 번 의미 통합합니다. 다른 개념은 별도로 유지하도록 지시합니다. 번역으로 중복을 판정하지 않으며 통합 모델도 후보 이름의 언어를 보존하도록 지시합니다.
- 미리보기에서 한국어 Content Nature와 Concept 이름을 확인합니다. **중요 표시**는 Concept의 Highlight를 바꿉니다. 이 선택은 현재 미리보기에서만 유지되며 재시작·새 미리보기 생성 후 사라집니다.
- 중간 실패 시 이전 정상 미리보기가 유지됩니다. 새 중간 추출 결과를 완료 Frame으로 저장하지 않으며 자동 이어받기/재개 기능은 없습니다.

### 처리 상한

| 항목 | 상한 |
| --- | --- |
| 문서 UTF-8 크기 | 512 KiB |
| 청크 수 | 32 |
| 청크 원문 크기 / 블록 수 | 16 KiB / 64 |
| 청크별 개념 / 문서 전체 원시 후보 | 16 / 128 |
| 호출별 입력 JSON | 96 KiB (Catalog·맥락 포함) |
| 문서 분류 집계 / 의미 통합 | 각각 최대 1회 |
| 문서 전체 논리 호출 / 재시도 포함 HTTP | 34 / 102 |

상한은 API의 최대치가 아닌 MVP 비용 예산입니다. [budget.ts](src/budget.ts)에서 관리합니다. 정적 입력은 첫 전송 전에 검사하며, 모델 후보 수·후속 입력 한도는 해당 응답/호출 시 검사합니다. 예산을 넘으면 일부 후보나 원문을 조용히 버리지 않고 실패합니다.

### 코드 읽는 순서

1. [framing.ts](src/framing.ts): 전체 실행·완료 경계와 추적 정보.
2. [chunks.ts](src/chunks.ts): 결정론적 처리 계획과 원문 위치 보존.
3. [concept-prompts.ts](src/concept-prompts.ts): 선택적 추출·통합 지침.
4. [concepts.ts](src/concepts.ts): 개념 이름/confidence 검사와 후보 병합.
5. [main.ts](src/main.ts): 진행 상태와 Concept 검토/Highlight UI.

새 코드에는 처리 이유와 각 단계의 역할을 설명하는 한글 주석을 추가했습니다. Domain 관련 규칙은 기존 classification-prompt/classification/domains/storage 계층에 유지됩니다.

### 저장·이력 호환

`data.json`은 v3를 유지합니다. 기존 local-test Frame은 Legacy로 조회하며 Concept으로 강제 변환하지 않습니다. 이전 Gemini Frame 2/3/4는 메모리 전용이었으므로 새 미리보기를 요청하면 Frame 5를 생성합니다. 외부에서 구버전 payload가 저장되어 있어도 사용자 annotation을 잃는 강제 변환은 하지 않습니다. Domain Catalog와 이전 Attempt는 보존됩니다.

호출별 runId는 고유하며 trace의 framingRunId로 같은 문서 실행을 연결합니다. stage/chunkId·원문 해시·청크/추출/통합 버전·실제 입력 해시·Catalog 해시·생성 설정으로 각 호출을 추적합니다. 전체 원문는 Attempt에 복제하지 않습니다. 통합 실패 후 수신된 사용량도 기존 Journal에 남습니다.

### 수동 품질 검수

짧은 메모, 중간 독서록, Heading이 많은 PRD, 긴 프로젝트 문서, 같은 개념이 반복되는 문서로 확인합니다. **Gemini 미리보기 요청** 후 청크별 진행 표시를 보고, 완료된 Concept이 원문 용어·언어를 보존하는지 확인하세요. 불필요한 개념이 생성되지 않는지, 같은 개념이 통합되면서 관련만 있는 다른 개념까지 합쳐지지 않는지 검토합니다. 기본 화면에 confidence/JSON이 노출되지 않고 Developer Details에서 접근 가능한지도 확인합니다.

외부 API를 쓰지 않는 자동 테스트에는 실제 저장소 PRD 입력과 64 KiB/128블록을 넘는 입력이 포함됩니다. 실제 Gemini 개념 품질·의미 통합 품질과 Obsidian 앱 수동 검수는 이 오프라인 결과와 별도로 평가해야 합니다.

### Retry와 평가 fixture

네트워크 실패와 HTTP 408/500/502/503/504만 초기 요청을 포함해 최대 3회 전송합니다. 첫 retry는 1.5~2초, 다음은 3~3.5초이며 실제 sleep과 random은 테스트에서 대체합니다. 400·429는 자동 retry하지 않습니다. 429에서는 요청·사용량·결제 한도를 확인하도록 안내합니다. timeout 이후 실제 HTTP가 끝날 때까지 잠금을 유지하고 늦게 도착한 사용량을 해당 시도에 기록합니다.

[평가 fixture](tests/fixtures/framing-evaluation.ts)에 한국어/영어/약어, 정보/의견/혼합/의미 부족, 긴 정보+짧은 감상 및 긴 의견+짧은 사실을 준비했습니다. 오프라인 테스트는 이 기대 응답의 전달·검증·UI 계약만 확인합니다. 실제 Gemini 평가에서는 fixture 원문으로 미리보기를 요청하여 언어 보존과 mixed 남용 여부를 별도로 기록하세요.

추적 버전: pipeline `concept-pipeline-v2`, 개념 추출 prompt/schema v2, 문서 분류 prompt/schema v4, 통합 prompt v2·알고리즘 v2. 통합 응답 모양은 그대로여서 schema v1을 유지합니다. 생성 설정(출력 토큰 포함)은 변경하지 않았습니다.
