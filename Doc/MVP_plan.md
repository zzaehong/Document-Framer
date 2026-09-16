## MVP 개발 단계별 목표

현재 범위: 1단계 로컬 테스트, 2단계 Domain lifecycle, 2S Framing Core 단순화 **별도 미리보기**. 설정·키 관리·저장 호환·승인 Catalog·신규 후보 검토·검증 범위는 [2단계 구현 기록](MVP_phase2.md)에 정리했다. 실제 결과의 활성 Frame 갱신과 후속 단계는 제외한다.

| 단계                   | 사용자가 확인할 결과                                 | 작은 개발 작업                                                  | 관련 FR               |
| -------------------- | ------------------------------------------- | --------------------------------------------------------- | ------------------- |
| **1. 수동 처리의 기본 흐름**  | 현재 문서에서 버튼을 누르면 대기 후 테스트 결과가 저장되고 표시됨       | 플러그인 실행 → 원문 읽기 → 요청·60초 대기 → 테스트 엔진 → 저장·조회              | 01~03, 09~11, 19 일부 |
| **2. 실제 AI Framing** | Domain 재사용·신규 후보 승인과 Type·Unit·Label을 구조화된 Review에서 확인    | 독립 Prompt → 승인 Catalog 입력 → 분류 검증 → Review → 후보 승인 저장                  | 04~08, 15           |
| **2R. Concept-based Framing revision** | 긴 문서를 개념과 여러 원문 근거로 검토 | 구조 청크 → 선택적 추출 → 중복 통합 → Concept Review | 06~09, 13 |
| **2S. Framing Core 단순화** | Domain·Content Nature·원문 언어 Key Concepts 검토 | Evidence/Label 제거 → schema 5 → prompt/UI → 3 attempts/backoff → 검증 | 05~09, 11, 13 |
| **3. 안전한 Reframing** | 수정된 원문으로 다시 분석하며 이전 정상 결과를 보호               | 원문 버전 비교 → 중복 요청 병합 → 구버전 결과 차단 → 저장 실패 처리                | 02, 10, 18          |
| **4. 자동 실행과 대기 제어**  | 다른 문서 수정을 시작하면 이전 문서가 조건에 맞춰 처리됨            | 편집 감지 검증 → 전환 트리거 → 문서별 대기 → 240초 상한·완료 초기화               | 19                  |
| **5. 사용자 중요도와 수정**   | Importance·Highlight·분류 수정을 저장하고 재분석 후에도 확인 | Importance → Highlight → Correction → 사용자 정보 보존·연결 불명확 처리 | 12~14, 18           |
| **6. 원문에 연결된 질문**    | 질문에서 원문을 확인하고 답변하면 결과에 반영됨                  | 질문 위치 표시 → 선택형·자유 응답 → 응답 저장·반영 → 오래된 위치 처리               | 16                  |
| **7. 질문 대기와 처리 분리**  | 질문이 미응답이어도 관련 없는 문서는 계속 처리됨                 | Non-blocking 유지 → Blocking 문서 보류 → 답변 후 재개 → 중복 질문 방지     | 17                  |
| **8. 복구와 MVP 검수**    | 재시작·파일 이동·API 장애에서도 상태와 복구 방법을 확인           | 미완료 복구 → 파일 동일성 처리 → 실패 시나리오 검증 → 실제 Vault 검수             | 전체 통합               |

### Phase 2 revision 구현 계획 (2026-09-15)

1. Prompt를 독립 파일로 옮기고 경로·출처 기반 Domain 계약 및 로컬 Catalog 검증을 정의한다.
2. data.json v3에 승인 경로 Catalog를 추가하고 v1/v2 Frame·호출 이력을 보존한다.
3. 요청별 Catalog 스냅샷을 전송·검증에 공유하고 평가 기록에 해시와 항목 수를 남긴다.
4. 미리보기의 후보 승인/거절과 구조화된 Review, 접힌 Developer Details를 구현한다.
5. 계약·마이그레이션·저장 실패/동시성·입력 재사용·UI 및 기존 회귀를 검증하고 문서를 실제 결과와 대조한다.

Step 3~8은 앞당기지 않는다. generation configuration, 원문/블록 한도, transport·Attempt Journal·SecretStorage 계약은 유지한다.

구현 결과: 위 revision을 완료했으며 `npm run build`, `npm test`(49개 통과), `git diff --check`로 검증했다. 실제 모델 의미 품질과 Obsidian 수동 검수는 README 절차를 따른다.

## 2R 구현 계획 (2026-09-16)

이전 Phase 2의 partition preview 및 Domain lifecycle 검증 기록은 보존한다. 이번에는 schema 4 → 결정론 청크 → Concept prompt/검증 → 여러 청크 실행 → 로컬 중복 병합 → 제한된 의미 통합 → UI/Highlight → 테스트 순으로 구현한다. 이 revision 이후 Safe Reframing으로 진행한다.

2R 구현 결과: Concept Frame 4, 구조 청크와 선택적 원문 Evidence, 로컬/의미 통합, Document 분류 집계, Concept Review/메모리 Highlight를 완료했다. `npm run build` 및 `npm test` 67개가 통과했다. 2단계의 49개 검증은 이전 revision 기록이며 현재 검증 결과는 2R이다. 다음 개발 단계는 Safe Reframing이며 실제 모델 품질 검수는 README 절차로 진행한다.

## 2S 구현 계획 (새 사용자 결정)

Evidence linking은 2R에서 시험했으나 문서 전체 개념의 넓은 근거 범위와 품질 문제로 MVP 가치 대비 복잡도가 컸다. 이 이력을 보존하면서 Evidence·Semantic Label을 제거한다.

순서: 문서 정합성 → Content Nature → Concept schema/validator 단순화 → 원문 언어 prompt/통합 → orchestration/schema 5 → Review UI → 제한된 retry/backoff 및 예산 → tests → build → 문서 대조.

Domain lifecycle·구조 청크·사용량·timeout 복구·SecretStorage·기존 저장 Frame은 유지한다. Gemini 결과는 메모리 미리보기이며 활성 Frame 저장, 전체 correction, Safe Reframing은 후속이다. 실제 데이터 조사: checkout의 테스트 Vault에는 data.json이 없으며 저장 코드는 로컬 schema 1 Frame만 생성한다. 외부 Vault는 이번 조사 범위가 아니다. 강제 migration을 하지 않는다.

2S 구현 결과: schema 5·Content Nature·원문 언어 개념 색인·Evidence/Label 제거·3 attempts/backoff·102 HTTP 상한·Review를 반영했다. `npm test` 82개, `npm run build`, `git diff --check`가 통과했다. 실제 모델 품질 및 Obsidian GUI 검수는 README 절차로 별도 확인한다. 2R의 67개 테스트와 설계는 이전 이력이다.
