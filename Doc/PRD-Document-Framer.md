> **Status:** Draft / Specification  
> **Version:** 0.7
> **Project:** Document Framer  
> **Timebox:** 10 days  
> **Workflow Stage:** Step 2 — Specify Observable Behavior

---

# 1. Purpose

Document Framer는 사용자가 Obsidian에 자유롭게 축적한 비정형 Markdown 문서를 자동으로 분석하여, 원문을 변경하지 않고 AI가 이후 활용할 수 있는 구조화된 Frame을 생성하는 최소 semantic metadata 생성 시스템이다.

Frame은 WHERE(Domain), WHAT KIND(Content Nature), WHAT ABOUT(Key Concepts)에 답한다. Markdown을 재구성하거나 요약하지 않는다.

사용자는 AI 활용을 위해 별도의 metadata, taxonomy 또는 문서 형식을 관리할 필요가 없어야 한다.

제품의 기본 경험은 다음과 같다.

```text
Write / Paste
     ↓
Automatic Save / Change Detection
     ↓
Stable Content + (Framing Request OR Edit Another Document)
     ↓
Document Framer
     ↓
Raw Document + Frame
```

Document Framer가 생성하는 Frame은 원본 지식이 아니라 재생성 가능한 annotation이다.

---

# 2. Users and Context

## 2.1 Primary User

초기 MVP의 사용자는 Obsidian을 개인 Knowledge Base로 사용하면서 향후 자신의 지식을 AI 시스템에서 활용하려는 개인 사용자다.

사용자의 Vault에는 다음과 같이 서로 다른 형태의 Markdown 문서가 혼재할 수 있다.

- 직접 작성한 글
- 짧은 메모
- 아이디어
- 일기 및 회고
- 프로젝트 기록
- AI가 생성한 답변
- AI 대화 기록
- 웹에서 가져온 자료
- 연구 및 학습 자료
- 기타 Markdown 텍스트

사용자는 이러한 자료를 AI 친화적인 형식으로 직접 변환하지 않는다.

---

# 3. Goals

## G-01 — Zero-Structure Ingestion

사용자가 별도의 metadata나 taxonomy를 입력하지 않아도 일반적인 Markdown 문서를 처리할 수 있다.

## G-02 — Automatic Framing

시스템은 문서를 분석하여 이후 AI 시스템이 사용할 수 있는 구조적 정보를 생성한다.

## G-03 — Preserve Raw Knowledge

원본 Markdown은 Source of Truth로 보존하고 AI가 생성한 annotation과 분리한다.

## G-04 — Lightweight Processing

일반적인 문서 처리는 고비용 reasoning model 없이 수행할 수 있어야 한다.

## G-05 — Human Authority

사용자는 AI가 생성한 classification을 수정할 수 있으며, 사용자가 직접 지정한 정보는 AI 추론한 정보다 높은 권위를 가진다.

## G-06 — Low-Friction Clarification

AI가 중요한 모호성을 해결해야 할 경우 가능한 한 낮은 interaction cost로 사용자에게 질문할 수 있다.

---

# 4. Non-goals

MVP에서는 다음 기능을 제공하지 않는다.

- Personal RAG
- Vector Database
- Semantic Retrieval
- Personal MCP
- AI Agent integration
- Multi-Agent workflow
- Knowledge Graph
- 자동 fact verification
- Evidence validity 평가
- 논리적 강도 평가
- 복잡한 reasoning evaluation
- 자동 문서 재작성
- 범용 문서 요약
- 자동 Vault 구조 변경
- 범용 Obsidian AI Assistant
- Model fine-tuning

이러한 기능은 Document Framer의 MVP 완료 조건에 포함되지 않는다.

---

# 5. Primary Scenarios

## S-01 — New Document Framing

**Actor:** User

**Trigger:** 대상 문서가 문서별 대기 시간 동안 변경되지 않았고, 사용자가 해당 문서의 Framing 버튼을 누르거나 다른 문서의 수정을 시작한다. 두 조건의 발생 순서는 무관하며 실제 실행 시 FR-19의 조건을 모두 만족해야 한다.

**Flow:**

1. 사용자가 Markdown 문서를 작성하거나 추가한다.
    
2. Document Framer가 원문 변경을 감지하여 처리 필요 상태로 표시한다. 자동 저장만으로 분석을 시작하지 않는다.
3. FR-19의 실행 조건이 충족될 때까지 대기한다.
    
4. 시스템이 deterministic metadata를 추출한다.
    
5. 시스템이 문서를 분석한다.
    
6. Document-level Frame을 생성한다.
    
7. 구조 청크별로 원문 언어를 보존한 Key Concept 이름을 추출한다.
    
8. 중복 Concept을 통합하고 문서 전체의 Content Nature를 판정한다.
    
9. Frame을 저장한다.
    
10. 사용자는 생성된 Frame을 확인할 수 있다.
    

---

## S-02 — Document Classification

시스템은 처리된 Document에 대해 다음 정보를 생성한다.

- Domain
    
- Content Nature
    
- Classification Confidence
    

Domain은 하나 이상 존재할 수 있다.

Domain은 최대 3단계 hierarchy를 표현할 수 있어야 한다. 승인 Catalog를 먼저 검토하고 합리적으로 맞는 기존 경로를 재사용하며, 부족한 경우에만 신규 후보를 제안한다.

예:

```text
Engineering
→ Computer Science
→ Artificial Intelligence
```

---

## S-03 — Knowledge Concept Classification

Key Concept은 문서의 semantic index다. 원문에 등장한 용어와 언어를 우선 보존하고, 이름을 추론해야 하면 원문의 주 언어를 사용한다. 개념은 문서 전체와 연결되며 근거 구간·역할 라벨·요약문을 생성하지 않는다. 청크와 문서에서 concepts: []도 정상이다.

---

## S-04 — Human Importance

사용자는 Document 전체에 중요도를 지정할 수 있다.

Document Importance는:

```text
1 ───────────── 10
```

범위의 점수로 표현한다.

사용자는 개별 Knowledge Concept을 별도로 Highlight할 수 있다.

Knowledge Concept Highlight는:

```text
ON / OFF
```

두 상태로 표현한다.

---

## S-05 — Human Correction

사용자는 AI가 생성한 classification이 잘못되었다고 판단할 경우 수정할 수 있다.

사용자가 수정한 classification은 이후 동일 Frame에서 AI가 생성한 classification보다 우선한다.

Reframing이 수행되더라도 사용자가 직접 입력하거나 수정한 정보를 실수로 덮어써서는 안 된다.

---

## S-06 — Domain Candidate Review

기존 ID S-06을 유지하며 **Domain Candidate Review**로 정책을 변경한다(2026-09-15 사용자 결정).

1. 승인된 Domain Catalog에서 문서를 합리적으로 표현하는 분야를 우선 재사용한다.
2. 적절한 분야가 없을 때만 다른 문서에도 재사용할 수 있는 안정적인 새 후보를 제안한다. 비슷한 의미의 불필요한 세분화는 피한다.
3. 새 후보는 미리보기에서 승인·거절할 수 있으며 미응답도 다른 문서 처리를 막지 않는다.
4. 명시적으로 승인하고 저장에 성공한 후보만 Catalog에 추가되어 이후 요청에 전달된다. 거절·미승인 후보는 전달하지 않는다.
5. 문서 자체의 의미로 분야를 판단할 수 없을 때만 Other를 사용한다. Catalog가 비어 있거나 적합한 기존 분야가 없다는 이유로 Other를 사용하지 않는다.

---

## S-07 — Anchored Clarification

AI가 Document의 특정 내용에 대해 사용자 확인이 필요하다고 판단한 경우 해당 원문 위치에 연결된 Clarification을 생성할 수 있다.

사용자는 어떤 내용에 대한 질문인지 원문의 위치를 통해 확인할 수 있다.

가능한 경우 질문은 선택형으로 제공한다.

예:

```text
Document

3 | 이 구조를 다음 프로젝트부터 기본 구조로 사용한다.
    └─ 💬 이 내용은 프로젝트의 결정 사항인가요?
       [결정] [아이디어] [아님] [기타...]
```

`기타`를 선택하면 자유 형식으로 답변할 수 있다.

사용자의 답변은 관련 Document 또는 Knowledge Concept의 Frame에 반영된다.

Clarification은 다음 두 종류를 지원한다.

- Non-blocking
    
- Blocking
    

Non-blocking Clarification은 답변을 기다리는 동안 다른 Document의 Framing을 방해하지 않는다.

Blocking Clarification은 해당 Document의 처리를 보류할 수 있지만 관련 없는 다른 Document의 Framing은 계속할 수 있다.

구체적인 Clarification trigger는 별도로 결정한다.

---

## S-08 — Reframing

모델 또는 taxonomy가 변경되거나 사용자가 다시 분석하기를 원하는 경우 Document의 Frame을 다시 생성할 수 있어야 한다.

Reframing은 Raw Markdown을 수정하지 않는다.

사용자가 직접 지정한 정보는 재생성 가능한 AI annotation과 구분되어야 한다.

---

# 6. Functional Requirements

## FR-01 — Markdown Ingestion

시스템은 처리 대상에 포함된 유효한 Markdown 문서를 입력으로 받을 수 있어야 한다.

---

## FR-02 — Raw Document Preservation

시스템은 Framing 과정에서 원본 Markdown 내용을 classification 결과로 인해 변경해서는 안 된다.

---

## FR-03 — Deterministic Metadata

시스템은 LLM 호출 없이 추출할 수 있는 문서 정보를 자동으로 수집해야 한다.

최소 metadata 범위는 Step 3에서 확정한다.

---

## FR-04 — Domain Classification

시스템은 Document에 하나 이상의 Domain을 할당할 수 있어야 한다.

Domain은 최대 3단계 hierarchy를 표현할 수 있어야 한다. 승인 Catalog를 먼저 검토하고 합리적으로 맞는 기존 경로를 재사용하며, 부족한 경우에만 신규 후보를 제안한다.

---

## FR-05 — Content Nature Classification

Content Nature는 information(정보), opinion(의견), mixed(정보 + 의견), unclassified(분류 어려움) 중 하나다. 사실·개념·이론·절차·외부 지식 정리가 중심이면 information, 작성자의 판단·주장·평가가 중심이면 opinion이다. 두 성격이 모두 문서 이해에 실질적으로 중요할 때만 mixed를 사용한다. 정보 글의 짧은 감상이나 의견 글의 짧은 사실 인용 때문에 mixed로 바꾸지 않는다. 의미·문맥이 부족할 때만 unclassified를 사용한다. 여러 청크는 전체 신호를 모델로 집계하며 단순 다수결하지 않는다.

---

## FR-06 — Key Concept Extraction

Heading → 문단/블록 → 크기 경계 순으로 결정론적 청크를 만들고 핵심 개념 이름을 추출한다. Heading만으로 개념을 강제하지 않는다. 개념 0개도 정상이다. NFC·대소문자·공백 정규화 중복은 로컬에서 병합하되 번역으로 동일성을 판정하지 않는다. 여러 청크의 의미 통합은 후보 표현과 언어를 보존한다. 필수 단계 실패는 완료로 공개하지 않는다.

---

## FR-07 — Semantic Evidence Label 폐기

이전 Semantic Evidence Label 요구는 폐기한다. 추적 ID FR-07은 폐기 기록으로 유지한다. 역할 라벨과 Evidence 계층은 새 schema·validator·prompt·merge·UI에 존재하지 않는다.

---

## FR-08 — Classification Confidence

AI가 생성한 classification에는 해당 판단의 confidence를 표현하는 정보가 존재해야 한다.

Confidence의 표현 방식과 threshold는 추후 결정한다.

---

## FR-09 — Frame Generation

Gemini Frame schemaVersion은 5다. document는 결정론 metadata·domains·contentNature·importance를 가진다. concepts의 항목은 id·concept·confidence·highlight만 가진다. Evidence, blockIds, 행/offset, 역할 라벨, 원문 발췌, 요약은 Concept에 저장하지 않는다. 모든 필수 단계가 성공하면 0개 Concept도 정상이다. 현재는 previewOnly: true인 메모리 미리보기이며 활성 Frame 저장은 후속이다.

---

## FR-10 — Frame Persistence

생성된 Frame은 원본 Markdown과 분리된 상태로 저장될 수 있어야 한다.

저장 방식은 Technical Design 단계에서 결정한다.

---

## FR-11 — Frame Inspection

기본 검토 화면은 Domain 경로·기존/신규 여부, 한국어 Content Nature, Concept 이름과 Highlight를 표시한다. 신규 Domain 승인·거절 흐름을 유지한다. Concept 아래 원문 발췌나 행 범위·라벨은 표시하지 않는다. confidence·JSON·모델·실행 버전은 접힌 Developer Details에 둔다. confidence는 모델 자기 평가이며 정확도 확률이 아니다.

---

## FR-12 — Document Importance

사용자는 Document에 1–10 범위의 Importance를 지정하고 변경할 수 있어야 한다.

---

## FR-13 — Knowledge Concept Highlight

사용자는 Concept의 중요성을 Highlight ON/OFF로 표시할 수 있어야 한다. 이번 2S 미리보기에서는 명시적 클릭으로 메모리의 highlight만 변경하며 재시작 시 사라짐을 표시한다. 영구 Human annotation 저장·Reframing 보존은 후속 단계다. Document Importance 요구는 유지한다.

---

## FR-14 — Human Correction

후속 단계에서 Domain, Content Nature, Concept 이름을 사용자가 수정할 수 있어야 한다. 사용자 값을 AI annotation과 구분하고 보존한다. 이번 변경은 전체 correction UI나 영구 저장을 추가하지 않는다.

---

## FR-15 — Domain Reuse and Candidate Approval

기존 ID FR-15의 새 이름은 **Domain Reuse and Candidate Approval**이다.

AI는 승인 Catalog를 입력받아 기존 분야를 우선 재사용하고, 충분히 표현할 수 없을 때만 재사용 가능한 새 Domain 후보를 제안해야 한다. 최대 3단계 경로와 multi-domain을 유지한다.

신규 후보는 명시적 사용자 승인 및 저장 성공 전에는 Catalog에 등록하지 않는다. 거절과 미응답은 등록하지 않으며 다른 문서 처리를 막지 않는다. 승인은 활성 Frame publication이나 전체 Human Correction을 의미하지 않는다.

existing 응답은 요청 당시 실제 Catalog와 일치해야 한다. 빈 값·비정상 길이·중복·잘못된 계층·잘못된 출처는 로컬 검증에서 거부하고 정상 미리보기로 공개하지 않는다. 응답을 조용히 수정하여 정상 결과로 취급하지 않는다.

Other는 의미적으로 분야 판단이 어려운 문서에만 사용하는 분류 불가 표시이며 승인 대상 Catalog 항목이 아니다. API/검증 실패를 Other로 대체하지 않는다.

---

## FR-16 — Anchored Clarification

시스템은 Document의 특정 내용에 대해 사용자 확인이 필요할 경우 해당 원문의 위치와 연결된 Clarification을 생성할 수 있어야 한다.

Clarification의 interaction model은 Google Docs의 anchored comment 방식을 따른다.

개념적으로:

```text
Document

1 | ...
2 | ...
3 | 이 구조를 다음 프로젝트부터 기본 구조로 사용한다.
    └─ 💬 이 내용은 프로젝트의 결정 사항인가요?
       [결정] [아이디어] [아님] [기타...]

4 | ...
```

Clarification은 최소한 다음 정보를 가져야 한다.

- 대상 Document
- 질문이 연결된 원문 위치
- 질문 내용
- 선택 가능한 응답
- 사용자 응답
- 상태

사용자는 가능한 경우 제공된 선택지를 통해 응답한다.

`기타`를 선택하면 자유 형식의 답변을 입력할 수 있다.

사용자가 응답한 결과는 해당 Document 또는 Knowledge Concept의 Frame에 반영되어야 한다.

MVP는 Google Docs의 전체 댓글 시스템을 구현하는 것을 요구하지 않는다. 특정 원문 위치에 질문을 연결하고 사용자가 이에 응답할 수 있는 interaction model만을 요구한다.

---

## FR-17 — Non-blocking Processing

Non-blocking Clarification에 사용자가 응답하지 않아도 다른 Document의 정상적인 Framing은 계속될 수 있어야 한다.

미응답 Non-blocking Clarification은 이후 사용자가 다시 확인하고 응답할 수 있는 상태로 유지되어야 한다.

Blocking Clarification은 해당 Document만 보류하며, 관련 없는 다른 Document의 Framing까지 중단시켜서는 안 된다.

---

## FR-18 — Reframing

시스템은 기존에 Frame이 존재하는 Document를 다시 Framing할 수 있어야 한다.

Reframing은 다음 경우를 지원하기 위한 기본 기능이다.

- Document 원문이 변경된 경우
- Classification을 다시 수행할 필요가 있는 경우
- 향후 model 또는 taxonomy가 변경된 경우

Reframing 과정에서도 Raw Markdown은 변경되지 않아야 한다.

AI-generated annotation은 새 분석 결과로 갱신할 수 있다.

반면 사용자가 직접 지정한 다음 정보는 AI-generated annotation과 구분되어야 한다.

- Document Importance
- Knowledge Concept Highlight
- Human Correction
- Clarification Response

Reframing이 수행되더라도 이러한 Human-authored 정보가 의도치 않게 AI 결과로 덮어써져서는 안 된다.

---

## FR-19 — Framing Trigger and Adaptive Waiting

### 실행 조건 — 사용자 확정

원문 변경 감지와 Framing 실행을 분리한다. 실행 조건은 다음과 같다.

`대상 문서가 W초 동안 변경되지 않음 AND (대상 문서의 Framing 버튼 요청 OR 다른 문서 수정 시작)`

- 처음 적용하는 대기 시간 W는 **60초**다.
- 버튼을 먼저 누르면 요청을 등록하고 안정 조건 충족까지 기다린다. 이미 W초 동안 변경이 없었다면 버튼 요청 시 실행할 수 있다. 버튼은 대기 시간을 우회하지 않는다.
- 문서 A를 수정한 뒤 문서 B의 수정을 시작하면 A가 자동 실행 후보가 된다. A의 마지막 원문 변경부터 W초가 지나야 실행한다. 단순히 B를 열거나 보기만 하는 것은 수정 시작에 포함하지 않는다.
- **변경 없음만으로 실행하지 않는다.** 다른 문서를 수정하지 않고 작업을 마친 마지막 문서는 버튼 요청이 있어야 처리된다.
- Importance·Highlight 변경 및 Frame 저장은 원문 변경이나 다른 문서 수정 시작으로 취급하지 않는다.

### 반복 수정에 따른 대기 증가 — 사용자 확정

문서별 대기는 **60 → 120 → 180 → 240초**로 증가하며 **240초를 초과하지 않는다**. Framing과 Knowledge Concept 추출을 포함한 처리가 정상 완료되면 해당 문서의 대기를 **60초로 초기화**한다. 다른 문서의 대기 시간에는 영향을 주지 않는다. 늘어난 대기는 버튼 경로와 다른 문서 수정 경로 모두에 적용한다.

완료의 구체화: 현재 원문과 일치하는 Frame에 Concept 추출·필수 annotation이 포함되고 검증 및 저장까지 성공해야 정상 완료로 인정한다. 구버전 원문의 늦은 응답, 부분 완료, 저장 실패 및 Blocking Clarification 대기는 초기화하지 않는다. Non-blocking 질문은 Frame 완료를 막지 않는다. 따라서 정상 완료 이후 다시 수정하면 60초부터 시작하며, 최신 원문에 대한 완료 전에 재수정이 반복될 때만 증가가 누적된다.

### 경계 동작 — 검토용 해석

아래 항목은 확정된 트리거를 구현 가능한 동작으로 구체화한 해석이다.

- 대기 시간은 항상 해당 문서의 **마지막 실제 원문 변경 시점**부터 계산한다. 대기 중 여러 번 수정해도 증가 단계는 올리지 않고 타이머만 다시 계산한다.
- 실행을 시작한 원문이 다시 변경되면 다음 처리의 대기 단계를 한 번 올린다. 정상 완료 이전의 변경에 적용하며, 같은 실행 이후 여러 번의 입력은 단계 증가 한 번으로 합친다. 정상 완료 이후 변경은 초기화된 60초에서 시작한다. 동일 원문에 대한 서비스 오류 재시도는 증가 사유가 아니다.
- 버튼 요청은 실행이 시작될 때 소비한다. 대기 중 원문이 변경되면 요청은 유지하되 최신 원문이 W초 동안 안정될 때까지 기다린다. 소비된 요청은 이후 수정의 실행 권한으로 재사용하지 않는다.
- 다른 문서 수정으로 후보가 된 A를 다시 수정하면 해당 전환 신호는 해제한다. 다시 다른 문서 수정을 시작하거나 A의 버튼을 눌러야 새 실행 조건을 충족한다. 이때 등록된 버튼 요청이 있다면 앞 항목을 따른다.
- 문서별 실행은 하나로 제한한다. 실행 중 수정·버튼 요청·문서 전환이 반복되어도 후속 작업은 최신 원문에 대한 하나의 후보로 합친다. 현재 실행 종료 후 안정 조건과 실행 신호를 다시 확인한다. 동일 원문 실행 중의 반복 클릭은 후속 실행을 추가하지 않는다.
- 내용이 같은 저장 이벤트는 대기 시간을 초기화하거나 새 분석을 만들지 않는다. 같은 내용으로 되돌아와 최신 정상 Frame과 일치하는 경우 자동 재분석하지 않는다. 완료된 동일 원문을 사용자가 버튼으로 다시 요청하면 FR-18의 명시적 Reframing을 허용한다.
- 사용자는 실행 조건 대기, 남은 안정 대기 시간, 실행 중, 재처리 필요를 최소 인터페이스에서 구분할 수 있어야 한다.

대기 상한 240초 및 정상 완료 시 60초 초기화는 확정되었다. 재시작과 편집 감지 방식은 OD-11에서 확정한다. 이 대기는 문서 작성에 따른 실행 빈도 제어이며, 모델 실패의 재시도 정책(OD-08)과 구분한다.

---

# 7. Acceptance Criteria

## AC-01 — End-to-End Framing

**Given** 처리 가능한 Markdown 문서가 존재할 때  
**When** 사용자가 해당 문서를 처리 대상으로 제공하고 FR-19의 실행 조건이 충족되면  
**Then** 시스템은 해당 문서에 대한 Frame을 생성하고 사용자가 그 결과를 확인할 수 있다.

---

## AC-02 — Zero Manual Metadata

**Given** 사용자가 별도의 Document Framer metadata를 작성하지 않은 일반 Markdown 문서가 있을 때  
**When** 문서를 처리하면  
**Then** 사용자의 사전 metadata 입력 없이 Framing 과정이 완료된다.

---

## AC-03 — Raw Content Preservation

**Given** Framing 전의 Markdown 문서가 있을 때  
**When** Framing 및 Reframing을 수행하면  
**Then** classification을 목적으로 원문의 본문이 변경되지 않는다.

---

## AC-04 — Multi-Domain

**Given** 하나의 문서가 둘 이상의 분야와 실질적으로 관련될 때  
**When** Domain Classification을 수행하면  
**Then** Frame은 하나 이상의 Domain을 동시에 표현할 수 있으며 기존 분야와 신규 후보의 출처를 각각 구분한다.

---

## AC-05 — Domain Hierarchy

**Given** 하위 분야가 존재하는 Domain이 있을 때  
**When** 해당 Domain을 Frame에 기록하면  
**Then** 기존 분야와 신규 후보 모두 1~3단계 경로로 표현할 수 있다. 4단계 이상과 비어 있는 경로는 거부한다.

---

## AC-06 — Knowledge Concepts

한국어 원문의 효율적 시장 가설·분산투자, 영어 원문의 Behavioral Finance, 혼합 표기의 자본자산 가격결정 모형(CAPM)을 보존할 수 있어야 한다. Evidence 없는 이름·confidence 응답 및 빈 concepts를 수용한다. 빈 이름·공백·제어/비가시 문자·예산 초과·0..1 밖 confidence는 거부한다. 원문은 변경하지 않는다.

---

## AC-07 — Content Nature and Minimal Metadata

정보 설명은 information, 개인 주장은 opinion, 정보와 판단이 모두 핵심이면 mixed, 의미 부족은 unclassified다. 긴 정보 글에 마지막 한 줄 감상이 있어도 information, 긴 의견 글에 짧은 사실 인용이 있어도 opinion을 기대한다. 새 Frame에 Evidence와 Semantic Label이 없고 UI에 한국어 분류명이 표시되어야 한다.

---

## AC-08 — Importance

**Given** 처리된 Document가 있을 때  
**When** 사용자가 1–10 범위의 Importance를 지정하면  
**Then** 해당 값이 Document Frame에 반영되고 다시 확인할 수 있다.

---

## AC-09 — Highlight

사용자가 Concept의 중요 표시를 누르면 해당 Concept의 highlight가 바뀐다. 현재 미리보기에서 유지되며 영구 저장되지 않는다는 점을 화면에서 알린다. 향후 Human-authored persistence는 원문 재분석으로 덮어쓰지 않는 원칙을 따른다.

---

## AC-10 — Human Correction

**Given** AI-generated classification이 존재할 때  
**When** 사용자가 해당 classification을 수정하면  
**Then** 수정된 값과 AI가 생성했던 값의 출처를 구분할 수 있다.

---

## AC-11 — Non-blocking Clarification

**Given** 미응답 상태의 Non-blocking Clarification이 존재할 때  
**When** 다른 Markdown Document가 처리 대상에 추가되면  
**Then** 기존 Clarification에 응답하지 않아도 새로운 Document의 Framing이 정상적으로 진행된다.

미응답 Clarification은 사용자가 이후 확인하고 응답할 수 있는 상태로 유지된다.

---

## AC-12 — Domain Reuse / Candidate Review

기존 ID AC-12를 **Domain Reuse / Candidate Review** 검증에 사용한다.

- Catalog에 Economics가 있으면 행동경제학 문서에 기존 Economics를 합리적으로 재사용할 수 있다. 불필요한 세분화를 피하는 의미 품질은 실제 문서 평가로 확인한다.
- 적합한 기존 분야가 없으면 새 후보를 표시할 수 있지만 자동 등록하지 않는다.
- 승인·저장 성공 후 재시작해도 Catalog가 유지되고 다음 요청의 existingDomains에 포함된다.
- 거절·미응답·저장 실패 후보는 이후 입력에 포함하지 않는다. 다른 문서 검토는 계속할 수 있다.
- Catalog에 없는 경로를 existing으로 반환하면 검증에 실패하며 기존 정상 결과를 보호한다.
- Other는 문서 의미로 분야를 판단할 수 없을 때만 사용한다. 빈 Catalog의 일반적인 문서는 새 후보를 제안할 수 있다.

---

## AC-13 — Anchored Clarification

**Given** 시스템이 특정 원문 내용에 대해 사용자 확인이 필요하다고 판단했을 때  
**When** Clarification을 생성하면  
**Then** 사용자는 어떤 원문 위치에 대한 질문인지 식별할 수 있다.

사용자는 제공된 선택지 또는 `기타`를 통한 자유 입력으로 응답할 수 있으며, 응답 결과는 관련 Frame에 반영된다.

---

## AC-14 — Reframing

**Given** 기존 Frame이 존재하는 Document가 있을 때  
**When** 해당 Document에 Reframing을 수행하면  
**Then** AI-generated annotation을 다시 생성할 수 있으며 Raw Markdown은 변경되지 않는다.

---

## AC-15 — Human Annotation Preservation

**Given** 사용자가 Importance, Highlight, Classification Correction 또는 Clarification Response를 입력한 Document가 있을 때  
**When** Reframing을 수행하면  
**Then** 해당 Human-authored 정보가 AI-generated annotation에 의해 의도치 않게 덮어써지지 않는다.

---

## AC-16 — Empty and Unsupported Input

**Given** 빈 문서, 공백만 있는 문서 또는 처리 한도를 초과한 문서가 있을 때  
**When** 처리를 요청하면  
**Then** 각각 처리할 내용 없음 또는 한도 초과 사유를 확인할 수 있고, 의미 없는 Concept이나 일부만 분석한 완료 Frame을 생성하지 않는다. 원문은 변경되지 않는다.

---

## AC-17 — Processing Failure Isolation

**Given** 문서 A의 읽기 또는 분석이 실패하고 문서 B는 정상 처리 가능할 때  
**When** 두 문서를 처리하면  
**Then** A의 실패 사유와 재시도 가능 여부를 확인할 수 있고 B는 계속 처리된다. 공통 모델 서비스 장애인 경우에는 영향을 받는 분석 작업을 대기로 표시하고 무한 재시도하지 않는다.

---

## AC-18 — Validated Frame Publication

**Given** 필수 필드 누락, 유효하지 않은 Content Nature 또는 Concept 이름/confidence가 포함된 분석 결과가 있을 때
**When** Frame 저장을 시도하면  
**Then** 해당 결과를 정상 완료 Frame으로 공개하지 않고 기존 정상 Frame과 사용자 정보를 보존한다.

---

## AC-19 — Latest Source Consistency

**Given** 원문 버전 A의 분석 중 원문이 B로 변경되었을 때  
**When** A의 결과가 뒤늦게 도착하면  
**Then** A의 결과를 B의 최신 Frame으로 표시하지 않는다. 사용자는 최신 원문에 대한 재처리가 필요하거나 진행 중임을 식별할 수 있다.

---

## AC-20 — Duplicate Processing

**Given** 동일 문서·동일 원문 버전의 저장 이벤트 또는 처리 요청이 중복되었을 때  
**When** 처리가 끝나면  
**Then** 활성 Frame과 동일한 미응답 질문이 중복 생성되지 않는다. 명시적인 Reframing은 가능하며, 서로 다른 파일을 내용이 같다는 이유만으로 병합하지 않는다.

---

## AC-21 — Unresolved Human Annotation Mapping

**Given** Highlight 또는 Human Correction이 적용된 Concept가 있고 원문 수정으로 개념 이름 또는 구성이 달라졌을 때
**When** Reframing 후 기존 Concept와 새 대상의 대응을 확정할 수 없으면
**Then** 사용자 정보와 이전 대상 정보를 보존하여 연결 확인 필요로 표시하고, 임의의 새 Concept에 적용하지 않는다. Document Importance는 동일 문서에서 유지된다.

---

## AC-22 — Stale Clarification Anchor

**Given** 질문 생성 후 원문이 변경되었을 때  
**When** 사용자가 질문을 열거나 답변하면  
**Then** 동일 대상임을 확인할 수 있을 때만 현재 위치에 연결한다. 확인할 수 없으면 이전 질문 대상과 연결 확인 필요 상태를 보여주고, 답변을 보존하되 다른 내용의 classification을 변경하지 않는다.

---

## AC-23 — Blocking Clarification Isolation

**Given** 문서 A에 미응답 Blocking Clarification이 있을 때  
**When** 문서 B가 처리되고 사용자가 A의 질문에 나중에 답하면  
**Then** B의 처리는 계속되며 A의 보류 상태와 질문을 다시 확인할 수 있다. A의 대상 위치가 여전히 유효하면 답변 반영 후 처리를 재개할 수 있다.

---

## AC-24 — Persistence Failure and Restart

**Given** 이전에 저장된 Frame과 사용자 정보가 있을 때  
**When** 새 Frame 저장이 실패하거나 저장 중 프로세스가 종료되면  
**Then** 마지막으로 정상 저장된 결과를 확인할 수 있고 불완전한 결과를 완료로 표시하지 않는다. 재시작 후 미완료 처리를 식별하고 재시도할 수 있다. 저장되지 않은 사용자 입력은 저장 성공으로 안내하지 않는다.

---

## AC-25 — Concurrent Human Update

**Given** Reframing이 진행 중일 때 사용자가 classification을 수정하거나 Clarification에 답변한 경우  
**When** 분석 결과가 저장되면  
**Then** 먼저 저장 성공한 최신 사용자 정보가 AI 결과로 덮어써지지 않는다. 대상 연결이 불확실하면 AC-21 또는 AC-22의 동작을 따른다.

---

## AC-26 — Source Identity Changes

**Given** 기존 Frame이 있는 원문이 이동·이름 변경·삭제되거나 접근 불가능해졌을 때  
**When** 시스템이 해당 상태를 감지하면  
**Then** 동일 문서임을 확인한 경우에만 기존 사용자 정보를 연결하고, 그렇지 않으면 연결 확인 필요 또는 원문 접근 불가로 표시한다. 같은 경로에 생긴 다른 파일에 이전 정보를 자동 적용하지 않는다.

---

## AC-27 — Input and Instruction Boundaries

**Given** 문서 본문에 시스템 지침 변경 명령, 외부 링크 또는 잘못된 사용자 입력값이 있을 때  
**When** 문서를 분석하거나 사용자 변경을 저장하면  
**Then** 본문 명령을 실행하지 않고, 링크 대상이나 첨부 내용을 자동 수집하지 않으며, 유효하지 않은 변경은 사유와 함께 거절하고 기존 값을 유지한다.

---

## AC-28 — Conjunctive Trigger

**Given** 변경이 필요한 문서 A의 대기가 60초이고 마지막 변경 시각이 t=0일 때  
**When** 버튼을 누르지 않고 다른 문서도 수정하지 않은 채 60초 이상 지나면  
**Then** A는 자동 실행되지 않는다. t=70에 버튼을 누르거나 다른 문서 수정을 시작하면 A는 실행 가능 상태가 된다.

---

## AC-29 — Button Request Waits for Stable Content

**Given** A의 마지막 변경이 t=0이고 대기가 60초일 때  
**When** t=10에 버튼을 누르고 t=40에 A를 다시 수정하면  
**Then** 요청을 유지하되 t=100 이전에는 실행하지 않는다. 추가 변경이나 다른 실행이 없다면 t=100부터 최신 원문을 한 번 처리할 수 있다.

---

## AC-30 — Editing Another Document

**Given** A의 마지막 변경이 t=0이고 대기가 60초일 때  
**When** t=20에 B의 수정을 시작하면  
**Then** A는 t=60부터 실행 가능하다. B를 열거나 보기만 했다면 실행 신호로 인정하지 않는다. t=40에 A를 다시 수정했다면 이전 B 전환 신호만으로 t=100에 실행하지 않는다.

---

## AC-31 — Capped Waiting and Completion Reset

**Given** A의 첫 Framing이 진행 중이며 대기가 60초일 때  
**When** 완료 전에 A가 다시 수정되어 최신 원문에 대한 후속 실행이 필요하면  
**Then** 다음 대기는 120초다. 각 후속 실행에서도 같은 상황이 반복되면 180초, 240초로 증가하고 이후에는 240초를 유지한다. 대기 중 여러 번 입력해도 단계는 추가 증가하지 않으며 다른 문서의 대기에는 영향을 주지 않는다.

**Given** A의 대기가 240초일 때  
**When** 최신 원문에 대한 Concept 추출·필수 annotation·Frame 검증 및 저장이 정상 완료되면
**Then** A의 대기는 60초로 초기화된다. 이후 새 수정과 유효한 실행 신호가 있으면 마지막 변경 후 60초부터 실행 가능하다. 구버전 결과 도착, 저장 실패, 부분 완료 또는 Blocking 질문 대기만으로는 초기화하지 않는다.

---

## AC-32 — One Execution and One Latest Candidate

**Given** A의 Framing이 진행 중일 때  
**When** A를 여러 번 수정하고 버튼 요청 또는 다른 문서 수정이 반복되면  
**Then** A의 동시 실행은 하나를 넘지 않고 후속 후보는 최신 원문 하나로 합친다. 다음 대기 단계는 한 번만 증가하며, 현재 실행 종료 후 유효한 실행 신호와 마지막 변경 이후의 증가된 대기가 모두 충족되어야 후속 실행한다. 이전 결과는 최신 원문의 결과로 표시하지 않는다.

---

## AC-33 — Non-content Events Do Not Trigger Framing

**Given** 원문 내용이 동일할 때  
**When** 저장 이벤트가 반복되거나 Importance·Highlight·Frame만 변경되면  
**Then** 안정 대기 시간을 초기화하거나 대기 단계를 증가시키거나 다른 문서 수정 신호를 만들지 않는다. 정상 완료된 동일 원문의 명시적 버튼 재분석은 허용하지만 실행 중 같은 원문의 반복 클릭은 합친다.

---

# 8. Relevant Quality Requirements

## QR-01 — Cost

일반적인 Framing pipeline은 고비용 reasoning model을 필수로 요구해서는 안 된다.

실제 비용 기준은 Classifier Spike 이후 확정한다.

## QR-02 — User Friction

일반적인 Markdown 저장 및 Framing 과정에는 사용자의 별도 classification 입력이 필요하지 않아야 한다.

## QR-03 — Data Integrity

AI-generated Frame을 생성하거나 삭제하더라도 Raw Markdown은 독립적으로 보존되어야 한다.

## QR-04 — Replaceability

AI-generated annotation은 특정 taxonomy 또는 특정 모델의 결과를 영구적인 사실로 취급하지 않아야 한다.

---

# 9. Constraints and Dependencies

## Constraints

- MVP 개발기간은 10일이다.
    
- Day 8을 Feature Freeze 목표로 한다.
    
- Markdown/Obsidian workflow를 유지한다.
    
- Raw Markdown은 Source of Truth다.
    
- Frame은 derived data다.
    
- Cheap-by-default를 따른다.
    
- Personal RAG는 MVP 범위 밖이다.
    

## Dependencies

MVP의 AI classification은 사용자 결정(2026-09-15)에 따라 Gemini를 baseline으로 검증한다. 기본 후보는 `gemini-3.1-flash-lite`이며 공식 문서의 지원 여부를 확인했다. 이번 구현은 실제 결과의 별도 미리보기까지다. [2단계 구현 기록](MVP_phase2.md)을 참고한다.

최종 모델 선택은 Classifier Spike 결과에 따라 확정한다.

---

# 10. Open Decisions

### OD-01 — Domain Taxonomy v0.1

고정 Domain 목록은 사용하지 않고 빈 Catalog에서 사용자 승인으로 축적한다(결정 완료). multi-domain·최대 3단계는 유지한다. 의미상 유사 분야의 재사용 품질 기준, 동의어·다국어 표기와 장기 Catalog 관리 정책은 실제 평가 후 결정한다.

### OD-02 — Semantic Taxonomy v0.1

Content Nature 4종은 확정했다. 실제 corpus에서 mixed 남용과 unclassified 과용을 측정하는 기준은 미결정이다. Decision/Idea signals는 이번 범위에서 제외한다.

---

### OD-03 — Structural Chunking and Concept Extraction

청크 구조는 유지하고 Concept은 문서의 semantic index로 단순화한다. 원문 언어 보존·개념 선택·의미 통합의 과병합/미병합 기준은 실제 모델 평가로 조정한다.

---

### OD-04 — Classification Model

사용자 결정(2026-09-15): Gemini를 사용하고 기본 후보는 `gemini-3.1-flash-lite`로 한다. 다른 모델로 자동 전환하지 않는다. 최종 품질 적합성은 실제 분류 실험으로 검증해야 한다.

### OD-05 — Classification Success Threshold

Classifier Spike에서 MVP에 충분하다고 판단할 품질 기준을 결정해야 한다.

### OD-06 — Frame Persistence

Frame 저장 방식을 Technical Design 단계에서 결정해야 한다.

### OD-07 — Clarification Trigger

Non-blocking / Blocking clarification을 생성하는 구체적인 조건을 결정해야 한다.

---

### OD-08 — Processing Limits and Retry Budget

현재 예산과 retry 정책은 아래 2S 처리 규칙으로 확정했다. 60초 논리 호출 timeout과 종료 미확인 복구를 유지한다. 실제 비용·지연·출력 사용량을 바탕으로 향후 조정하며 한도 초과 시 일부만 조용히 처리하지 않는다.

### OD-09 — Source Identity and Annotation Mapping

문서 이동·이름 변경 시 동일성 판정 방식, 원문 버전 식별, Concept 및 Clarification anchor의 대응 기준을 Step 3에서 결정한다. 자동 재연결을 확정할 수 없을 때는 사용자 정보를 보존하고 연결 확인 필요로 표시한다. 복잡한 자동 병합과 완전한 편집 이력 관리는 MVP에 요구하지 않는다.

### OD-10 — Unclassifiable Content and Clarification Bounds

의미가 부족한 문서는 Content Nature unclassified로 표현한다. 자동 질문과 재생성 기준은 후속 단계에서 정하며 무응답만으로 반복 요청하지 않는다.

---

### OD-11 — Adaptive Waiting Reset and Edit Detection

사용자가 확정한 규칙은 두 가지 AND 트리거, 문서별 60초 선형 증가, 상한 240초, Framing 및 Concept 추출 정상 완료 시 60초 초기화다. 다음 세부 사항은 아직 확정하지 않았다.
- 재시작 시 대기 단계와 미처리 요청을 어떻게 유지할지. 재시작만으로 빈도 제한이 우회되지 않도록 설계한다.
- Obsidian 사용자 편집을 외부 동기화·일괄 파일 변경과 구분하는 관찰 방식. 파일 변경 이벤트만으로 사용자의 문서 전환을 확정할 수 있는지는 Step 3에서 검증한다. 판별이 불가능할 때 임의로 다른 문서 수정 신호를 만들지 않으며 버튼 경로를 유지한다.

FR-19의 경계 동작은 검토용 해석이며, 이 항목의 구체적인 값과 관찰 방식은 관련 구현 전에 확정한다.

---

# 11. Specification Status

현재 PRD는 Document Framer MVP의 **observable behavior 초안**이다.

다음 작업은 이 문서의 요구사항을 검토하여 다음 세 종류로 분류하는 것이다.

- 반드시 MVP에 필요한 요구사항
    
- 10일 scope에서 제거 가능한 요구사항
    
- 아직 제품 결정이 필요한 요구사항
    

사용자 요청에 따라 Step 3 — Technical Design 논의를 시작한다. 미결정 사항은 유지하며 관련 구현 전에 확정하거나 spike로 검증한다. 설계 논의 시작은 전체 구현 준비 완료를 의미하지 않는다.

---

# 12. Edge Cases and Failure Handling

> **추가 상태:** 검토 초안 — 기존 FR-01~18의 예외 상황을 구체화한다. 10일 MVP 범위를 유지하며 세부 기술과 수치 기준은 해당 Open Decision에서 확정한다.

## 12.1 Common Rules

- 원문을 수정하거나 유실시키는 방식으로 분석 실패를 복구하지 않는다.
- 실패한 새 분석은 마지막 정상 Frame을 대체하지 않는다. 이전 Frame을 보여줄 때 최신 원문과 일치하지 않으면 그 사실을 표시한다.
- AI annotation과 Human-authored 정보를 구분한다. **사용자 정보 보존과 현재 원문에 대한 적용 여부는 별개다.** 연결이 불확실한 정보는 보존하되 자동 적용하지 않는다.
- `기타(Other)`는 문서 의미를 판단할 수 없는 경우의 분류 불가 표시다. Catalog 부재의 fallback이 아니다. API 오류, 읽기 실패, 잘못된 분석 결과를 `기타`로 숨기지 않는다.
- 완료, 처리 중, 사용자 응답 대기, 실패, 처리할 내용 없음 등을 사용자가 구분할 수 있어야 한다. 원문 최신성 및 연결 확인 필요 여부는 처리 상태와 함께 표현할 수 있다. 구체적인 상태명과 저장 형식은 Step 3에서 결정한다.
- 사용자는 실패 대상, 실패 단계, 이해 가능한 사유, 재시도 또는 수정 필요 여부를 최소 인터페이스에서 확인할 수 있어야 한다. 별도 운영 대시보드는 요구하지 않는다.

## 12.2 Input and Document Lifecycle

| ID | 상황 | 기대 동작 | 관련 요구사항 / 검증 |
| --- | --- | --- | --- |
| EC-01 | 빈 파일 또는 공백만 존재 | 분석할 내용 없음으로 표시하고 LLM 호출과 의미 없는 Concept 생성을 하지 않는다. 기존 Frame이 있다면 현재 빈 원문의 결과인 것처럼 표시하지 않는다. | FR-01, FR-06 / AC-16 |
| EC-02 | 짧은 메모, 혼합 언어, 코드·표·링크만 있는 문서, 비정형 Markdown | 형식이 일정하지 않다는 이유만으로 거절하지 않는다. 읽을 수 있는 원문 범위 안에서 처리하고, 의미 분류가 불가능하면 OD-10의 미분류 동작을 적용한다. 없는 내용을 추론해 채우지 않는다. | FR-01, FR-05~08 / AC-02, AC-18 |
| EC-03 | 파일 크기 또는 모델 입력 한도 초과 | 한도 초과와 사용자 조치를 알리고 해당 처리를 중단한다. 뒤쪽 내용을 말없이 버리거나 일부 분석을 전체 완료로 표시하지 않는다. 2S에서는 구조 청크로 처리하되 명시된 문서/청크/요청 예산을 넘으면 실패한다. | FR-01, FR-09 / AC-16; OD-08 |
| EC-04 | 읽기 권한 없음, 잠긴 파일, 읽을 수 없는 인코딩 | 해당 문서의 실패 사유를 표시하고 다른 문서 처리를 계속한다. 접근 복구 후 재시도할 수 있다. 원문 인코딩을 자동 변환해 덮어쓰지 않는다. | FR-01~02 / AC-17 |
| EC-05 | 중복 저장 이벤트 또는 중복 처리 요청 | 동일 문서·원문 버전의 요청으로 활성 Frame이나 동일 질문이 중복 생성되지 않는다. 내용이 같은 별도 파일의 사용자 정보는 독립적으로 취급한다. | FR-10, FR-16, FR-18 / AC-20 |
| EC-06 | 분석 도중 원문을 연속 수정 | 분석 대상 버전과 현재 원문을 구분한다. 뒤늦게 끝난 구버전 결과가 신버전 결과를 덮어쓰지 않으며 최신 원문의 처리 필요 여부를 표시한다. | FR-09, FR-18 / AC-19 |
| EC-07 | 파일 이동·이름 변경·삭제 또는 Vault 접근 중단 | 동일성이 확인될 때만 재연결한다. 접근 불가를 삭제로 단정해 기존 Frame·사용자 정보를 지우지 않는다. 원문을 자동 복원하거나 같은 경로의 다른 파일에 이전 정보를 적용하지 않는다. | FR-10, FR-14, FR-18 / AC-26; OD-09 |
| EC-08 | 외부 링크·임베드 또는 분석 지침처럼 쓰인 본문 | 본문은 분석 대상 데이터로 취급한다. 본문 지시로 설정·원문·taxonomy를 변경하거나 명령을 실행하지 않는다. 외부 링크·첨부 내용은 자동 수집하지 않고 접근하지 않은 내용을 분석했다고 표시하지 않는다. | FR-01~02, FR-15 / AC-27 |

## 12.3 Classification and Service Failures

| ID | 상황 | 기대 동작 | 관련 요구사항 / 검증 |
| --- | --- | --- | --- |
| EF-01 | 모델 timeout, 일시적 네트워크 장애, 요청 제한 | 유한한 재시도 정책을 적용한다. 한도 소진 후 실패 또는 재시도 대기로 표시한다. 공통 서비스 장애 시 관련 분석 작업은 대기할 수 있으나 기존 Frame 조회와 사용자 정보 편집은 가능한 범위에서 유지한다. | FR-10~14, QR-01 / AC-17; OD-08 |
| EF-02 | 인증 오류, 사용량·결제 한도 등 설정 변경이 필요한 오류 | 반복 자동 요청을 멈추고 필요한 설정 조치를 안내한다. 해결 후 재시도할 수 있다. 고비용 모델로 자동 전환하지 않는다. | QR-01, FR-18 / AC-17; OD-08 |
| EF-03 | 응답 형식 오류, 필수 필드 누락, 허용되지 않은 label·confidence, 잘못된 source location | 검증 실패로 취급한다. 잘못된 응답은 완료 Frame으로 저장하지 않는다. 현재 Phase 2에서는 검증 실패의 자동 재시도나 보정 호출을 하지 않는다. 모델 응답의 임의 label을 taxonomy에 추가하지 않는다. | FR-04~10, FR-15 / AC-18 |
| EF-04 | 일부 Knowledge Concept 분석만 성공 | 전체 Frame 완료로 표시하지 않는다. 기존 정상 Frame을 보존하며 재시도할 수 있게 한다. 중간 결과 공개·청크 단위 재시작은 MVP 필수가 아니다. | FR-06~10 / AC-18, AC-24 |
| EC-09 | 여러 의미가 섞이거나 분류 confidence가 낮음 | 허용 taxonomy 내 multi-label을 사용할 수 있으며 불확실성을 유지한다. 적합한 승인 Domain이 없으면 신규 후보를 제안하고, 문서 의미를 판단할 수 없을 때만 `기타`를 사용한다. 낮은 confidence만으로 모든 문서를 Blocking하지 않고 OD-07의 조건을 적용한다. | FR-04~08, FR-15~17 / AC-07, AC-12; OD-10 |

## 12.4 Human Information and Clarification

| ID | 상황 | 기대 동작 | 관련 요구사항 / 검증 |
| --- | --- | --- | --- |
| EC-10 | Reframing으로 Concept 추출·병합·삭제 | 기존 Highlight·Correction·Response와 이전 대상을 보존한다. 대응이 확정된 경우만 새 대상에 적용하고 나머지는 연결 확인 필요로 표시한다. 완전한 자동 재매핑 UI는 요구하지 않는다. | FR-13~14, FR-18 / AC-21 |
| EC-11 | 질문 이후 줄 삽입·삭제 또는 대상 문장 변경 | 줄 번호만 같다는 이유로 다른 문장에 연결하지 않는다. 원문 위치의 대상 동일성을 확인하거나 이전 질문 대상과 연결 확인 필요 상태를 보여준다. 불확실한 답변을 현재 classification에 자동 적용하지 않는다. | FR-16, FR-18 / AC-22 |
| EC-12 | 질문 장기 미응답 또는 같은 질문의 반복 생성 | Non-blocking 질문은 나중에 답할 수 있게 유지하고 Blocking 질문은 해당 문서만 보류한다. 무응답을 동의로 해석하지 않으며 무응답만으로 동일 질문을 계속 생성하지 않는다. | FR-16~17 / AC-11, AC-20, AC-23 |
| EC-13 | Reframing 중 사용자 수정 또는 답변 | 저장된 최신 사용자 변경을 새 AI 결과보다 우선한다. 여러 편집 요청이 충돌하면 조용히 덮어쓰지 않고 다시 확인하도록 알린다. 질문 중복 제출은 동일 응답의 중복 반영을 만들지 않는다. | FR-14, FR-16, FR-18 / AC-25 |
| EC-14 | 범위 밖 Importance, 유효하지 않은 label 또는 빈 답변 제출 | 유효성 오류를 알리고 기존 저장값을 유지한다. 빈 답변을 응답 완료로 바꾸지 않는다. Importance의 소수점 허용 여부 등 세부 입력 규칙은 구현 전 확정한다. | FR-12~14, FR-16 / AC-27 |
| EC-15 | taxonomy 변경으로 사용자 지정 label이 더 이상 유효하지 않음 | 기존 값과 사용자 작성 출처를 보존하고 현재 taxonomy와의 불일치를 표시한다. AI가 새 label로 대체하거나 기존 사용자 값을 삭제하지 않는다. | FR-14, FR-18 / AC-15 |

## 12.5 Persistence and Recovery

| ID | 상황 | 기대 동작 | 관련 요구사항 / 검증 |
| --- | --- | --- | --- |
| EF-05 | 디스크 부족·권한 오류 등으로 Frame 또는 사용자 수정 저장 실패 | 저장 성공으로 안내하지 않는다. 마지막 정상 Frame 및 저장된 사용자 정보를 유지하고 실패 대상과 재시도 필요를 표시한다. 저장 실패한 입력을 복구할 수 없는 경우 다시 입력해야 함을 알린다. | FR-10, FR-12~14, FR-16 / AC-24 |
| EF-06 | 처리 또는 저장 중 프로세스 종료·재시작 | 불완전한 결과를 완료로 취급하지 않는다. 미완료 작업을 식별하고 안전하게 재시도할 수 있다. 재시작 시 자동 재개 또는 모델 호출의 정확히 1회 실행 보장은 MVP 필수가 아니다. | FR-10, FR-18 / AC-20, AC-24 |
| EF-07 | 기존 Frame이 손상되었거나 읽을 수 없음 | 손상을 알리고 원문을 보존한다. 원문에서 AI annotation을 다시 생성할 수 있지만 복구하지 못한 사용자 정보를 복구한 것처럼 표시하지 않는다. 이 MVP는 외부 손상·사용자 삭제에 대한 완전한 백업 복구를 보장하지 않는다. | FR-02, FR-10, FR-18 / AC-03, AC-24 |

## 12.6 Review and Scope Notes

v0.2는 예외 상황과 AC-16~27을 추가했다. v0.3은 사용자 결정에 따라 FR-19, AC-28~33, OD-11을 추가하고 S-01 및 AC-01을 실행 조건에 맞게 수정했다. FR-01~18은 유지한다. v0.4는 대기 상한 240초와 정상 완료 후 초기화를 FR-19·AC-31·OD-11에 반영했다. 모델·taxonomy·품질 기준·Clarification trigger 등 OD-01~07은 여전히 미결정이며, edge case 추가만으로 PRD 확정 또는 구현 준비 완료를 의미하지 않는다.

v0.5는 2026-09-15 사용자 결정으로 Brief와의 Domain 충돌을 해소했다. S-06/FR-15/AC-12의 추적 ID를 유지하며 기존 분야 우선 재사용·신규 후보 제안·승인 후 등록으로 통일한다. 고정 Domain 목록 요구는 대체하지만 자동 등록 금지는 유지한다. Brief의 중요도 후보 척도보다 PRD의 1–10 점수 및 Unit Highlight ON/OFF를 따른다. AI Agent Dashboard의 Agent integration·Multi-Agent 기능은 Document Framer의 MVP 범위에 포함하지 않는다.

Step 3에서는 OD-08~11 및 기존 Open Decisions를 해당 기능 구현 전에 해소한다. 관련 AC는 고정된 입력 문서, 모델 실패 응답, 저장 실패 및 원문 변경을 재현해 검증할 수 있어야 한다. 복잡한 자동 anchor 복구, Unit 병합 UI, 자동 백업 서비스, 운영 대시보드는 이번 추가 범위에 포함하지 않는다.


## 12.7 Continuous Autosave and Interleaved Editing

| ID | 상황 | 기대 동작 | 관련 요구사항 / 검증 |
| --- | --- | --- | --- |
| EC-16 | Obsidian 자동 저장으로 연속 변경 | 변경은 처리 필요 상태와 마지막 변경 시각만 갱신한다. 안정 대기와 버튼 또는 다른 문서 수정 신호가 모두 있어야 실행한다. | FR-19 / AC-28~30 |
| EC-17 | A와 B를 번갈아 수정 | 각 문서의 전환 신호와 안정 대기를 독립적으로 판정한다. 후보 문서를 다시 수정하면 기존 전환 신호를 해제한다. Framing 실행 후 정상 완료 전 재수정에만 다음 대기를 60초 늘리며 상한은 240초다. 최신 결과가 정상 완료되면 60초로 초기화한다. | FR-19 / AC-30~32 |
| EC-18 | 마지막 문서 작성 후 그대로 종료 | 안정 대기만으로 자동 실행하지 않는다. 다른 문서 수정이 없으면 Framing 버튼 요청이 필요하다. 종료·재시작 시 요청 처리는 OD-11에서 확정한다. | FR-19 / AC-28~29 |
| EC-19 | 외부 동기화 또는 일괄 파일 수정 | 사용자 문서 전환으로 확인되지 않은 파일 변경을 다른 문서 수정 시작으로 간주하지 않는다. 감지 방식은 OD-11에서 검증한다. | FR-19; OD-11 |

## 12.8 Domain Candidate Review 경계

- 기존 경로의 표기 변경·중복·존재하지 않는 existing은 오류다. 규칙은 Phase 2 revision의 정규화 계약을 따른다.
- 승인 저장 실패는 성공으로 표시하지 않고 다시 승인할 수 있다. 동시 승인·Frame·설정·호출 기록 저장은 서로의 데이터를 보존한다.
- 미리보기 교체·원문 삭제/이동·플러그인 종료 후 남은 창에서 후보 승인을 새로 시작하지 않는다.
- 미승인·거절 상태는 이번 preview-only slice에서 메모리에만 유지한다. 재시작 후 후보는 사라지고 승인 Catalog만 보존된다. 이는 전체 Clarification persistence의 구현을 뜻하지 않는다.


## 2S Framing Core — 처리 예산과 실패 정책

- 문서 512 KiB·32청크, 청크 16 KiB·64블록, 청크당 16개 Concept·문서당 128개 원시 후보, 직렬화 입력 96 KiB를 유지한다.
- 논리 호출 최대 34회(추출 32 + 통합 1 + 문서 집계 1). HTTP는 호출당 최대 3 attempts이므로 최대 102회다. 구현은 공통 상수로 계산한다.
- network failure 및 408/500/502/503/504만 최대 2회 재시도한다. backoff는 1.5초/3초에 최대 0.5초 jitter를 더한다. 400·429는 재시도하지 않는다.
- timeout·미해결 요청 복구·사용량 기록·원문 보존은 유지한다. 어느 필수 단계라도 실패하면 이전 정상 미리보기를 보호한다.
- Generation config는 유지한다. 실제 출력 사용량을 측정한 뒤 별도 결정으로 조정한다.

## 변경 이력

v0.6/2R은 Concept + Evidence 연결을 시험했다. 실사용에서 문서 전체에 걸친 개념의 Evidence가 지나치게 넓어지고 복잡도 대비 MVP 가치가 부족했다. v0.7/2S는 Evidence·Semantic Label을 의도적으로 제거하고 Domain + Content Nature + Key Concepts로 단순화한다. 기존 저장 Frame과 사용자 annotation은 변형하지 않는다. 새 미리보기 schema 5와 legacy 저장 결과를 구분한다. Safe Reframing·영구 사용자 수정·Clarification은 후속이다.
