> **상태:** Shape / Draft  
> **프로젝트:** Document Framer  
> **목표:** 10일 MVP  
> **현재 단계:** Software Design Workflow — Step 1: Shape the Work

---

## 1. Problem

### 1.1 Affected User

Document Framer의 초기 사용자는 **Obsidian을 기반으로 개인 지식과 문서를 축적하면서, 이를 향후 AI와 함께 활용하려는 개인 사용자**다.

사용자는 문서를 체계적으로 작성하는 것만을 전제로 하지 않는다. 실제 Vault에는 다음과 같은 다양한 형태의 정보가 함께 존재할 수 있다.

- 사용자가 직접 작성한 Markdown 문서
- 짧은 메모와 생각
- 일기 및 회고
- 프로젝트 기록
- AI와의 대화 또는 AI가 생성한 답변
- 인터넷에서 복사한 글
- 논문 및 연구자료를 정리한 내용
- 외부 문서에서 가져온 참고자료
- 서로 다른 형식과 품질을 가진 기타 텍스트

사용자는 이러한 문서를 저장할 때 AI를 위한 별도의 데이터 구조를 이해하거나 관리할 필요가 없어야 한다.

---

### 1.2 Current Situation

개인의 지식은 본질적으로 비정형적이다.

사람은 항상 동일한 형식으로 문서를 작성하지 않으며, 모든 정보를 효율적으로 정리하지도 않는다.

특히 장기간 운영되는 Obsidian Vault에는 사용자가 직접 작성한 내용뿐 아니라 외부에서 가져온 자료와 AI가 생성한 내용까지 혼합될 수 있다.

이러한 문서는 인간이 직접 읽을 때는 의미를 파악할 수 있지만 AI가 대규모로 활용하려 하면 다음 문제가 발생한다.

**구조가 일정하지 않다.**

문서마다 제목, Heading, 문단 구성, 작성 방식 등이 다르다.

**내용의 성격이 혼합된다.**

하나의 문서 안에도 주장, 근거, 결론, 의견, 아이디어, 질문, 결정 등이 함께 존재할 수 있다.

**분야가 명시되어 있지 않다.**

어떤 문서가 과학, 공학, 경제학, 금융, AI 등 어떤 분야와 관련되어 있는지 별도로 기록되어 있지 않을 수 있다.

**출처와 작성 방식이 다양하다.**

사용자가 작성한 문서, AI 답변, 외부 글 등이 동일한 Vault 안에 존재할 수 있다.

**사용자에게 직접 구조화를 요구할 수 없다.**

모든 문서에 metadata, taxonomy, label 등을 사용자가 직접 작성하도록 요구하면 기록 과정의 마찰이 커지고 장기적인 사용성이 떨어진다.

따라서 Personal RAG를 구축하기 전에 **비정형 문서를 낮은 비용으로 일정한 지식 구조로 변환하는 과정**이 필요하다.

---

### 1.3 Core Problem

> **사용자에게 별도의 문서 구조화 작업을 요구하지 않으면서, Obsidian에 축적되는 다양한 비정형 Markdown 문서를 AI가 이후 검색하고 활용하기 좋은 형태로 어떻게 구조화할 것인가?**

Document Framer는 이 문제를 해결하기 위한 경량 문서 구조화 계층이다.

---

# 2. Outcome

## 2.1 Desired Change

### Before

사용자는 Obsidian에 다양한 문서를 자유롭게 저장한다.

```text
Obsidian Vault

├─ 직접 작성한 글
├─ AI 답변
├─ 웹에서 복사한 글
├─ 일기
├─ 연구자료
├─ 프로젝트 문서
└─ 기타 메모

→ 내용은 존재하지만 구조는 일정하지 않음
```

AI가 이를 활용하려면 원문을 직접 읽고 매번 문맥과 의미를 다시 판단해야 한다.

### After

사용자는 기존과 동일하게 문서를 작성하거나 붙여넣기만 한다.

```text
Write / Paste / Save
        ↓
Document Framer
        ↓
Raw Document + Frame
```

Document Framer가 자동으로 문서를 분석하여 AI가 활용할 수 있는 구조적 정보를 생성한다.

사용자는 이 구조를 이해하거나 직접 관리하지 않아도 된다.

---

## 2.2 MVP Outcome

10일 후에는 실제 Obsidian Vault의 Markdown 문서를 대상으로 다음 end-to-end 흐름이 작동해야 한다.

```text
Markdown Document
        ↓
Document Detection / Ingestion
        ↓
Deterministic Metadata Extraction
        ↓
Knowledge Unit Segmentation
        ↓
Lightweight Classification
        ├─ Domain
        └─ Semantic Labels
        ↓
Frame Generation
        ↓
Frame Persistence
        ↓
User Inspection
```

필요한 경우 사용자는 중요한 정보의 Importance를 지정하거나 AI가 생성한 간단한 clarification에 응답할 수 있다.

MVP의 목적은 Personal RAG 자체를 완성하는 것이 아니라 **Personal RAG에 입력할 수 있는 구조화된 Raw Knowledge를 생성하는 것**이다.

---

## 2.3 Success Signals

### Classification Quality

Domain과 Semantic Label이 이후 지식 검색 및 활용에 사용할 수 있을 정도로 유용하게 분류되어야 한다.

정확한 목표 수치는 현재 확정하지 않는다.

실제 문서 corpus와 human-labeled ground truth를 사용한 benchmark 이후 현실적인 기준을 결정한다.

### Human Friction

일반적인 문서 추가 과정에서는 사용자가 metadata나 semantic label을 직접 입력할 필요가 없어야 한다.

기본적인 사용자 경험은 다음과 같아야 한다.

```text
Write / Paste
     ↓
Save
     ↓
Done
```

사용자 개입은 중요도 지정 또는 중요한 모호성을 해결하는 경우에 한정한다.

### Processing Cost

문서가 지속적으로 증가하더라도 사용할 수 있도록 분류 비용을 낮게 유지한다.

기본적으로 가능한 한 저렴하거나 로컬에서 실행 가능한 모델을 활용하는 것을 지향한다.

정확한 비용 기준은 모델 benchmark 이후 결정한다.

---

# 3. Effort Appetite

**Timebox: 10일**

10일은 예상 개발기간이 아니라 고정된 scope budget으로 사용한다.

> **Fix time, vary scope.**

10일 안에 모든 기능을 구현할 수 없다면 기간을 늘리는 것보다 optional scope를 제거한다.

### 목표 일정

**Day 1–2**

- Specification
    
- Taxonomy 초안
    
- Critical Risk 검증
    
- Classifier Spike
    

**Day 3–8**

- Vertical Slice 구현
    
- 실제 문서 기반 반복 검증
    

**Day 8**

- Feature Freeze 목표
    

**Day 9–10**

- Acceptance Criteria 검증
    
- 오류 수정
    
- 비용/성능 측정
    
- Documentation reconciliation
    

Day 9 이후에는 원칙적으로 새로운 기능을 추가하지 않는다.

---

# 4. Boundaries

## 4.1 In Scope

MVP에는 다음 기능을 포함한다.

### Markdown Ingestion

Obsidian Vault에 존재하는 Markdown 문서를 처리할 수 있다.

### Deterministic Metadata Extraction

LLM이 필요하지 않은 정보를 자동으로 추출한다.

예:

- 파일 정보
- 제목
- Heading
- 링크
- 문서 구조
- 수정 정보
- 기타 기계적으로 확인 가능한 metadata

### Knowledge Unit Segmentation

문서를 classification 가능한 의미 단위로 분리한다.

정확한 기본 단위는 아직 결정하지 않았다.

### Domain Classification

문서 또는 Knowledge Unit이 어떤 지식 분야와 관련되어 있는지 계층적이고 복수 선택 가능한 형태로 분류한다.

예:

```text
Engineering
└─ Computer Science
   └─ Artificial Intelligence
```

하나의 문서는 여러 Domain에 속할 수 있다.

### Semantic Classification

문서 내부 내용을 의미적 역할에 따라 분류한다.

현재까지 논의된 후보에는 다음이 포함된다.

- Claim
- Evidence
- Reasoning
- Conclusion
- Opinion
- Idea
- Decision
- Question
- Observation
- Reference

최종 taxonomy는 아직 확정하지 않는다.

### Confidence

AI가 생성한 classification에는 confidence 정보를 연결할 수 있어야 한다.

AI classification은 원문의 사실 자체가 아니라 **재생성 가능한 annotation**으로 취급한다.

### Frame Persistence

원문을 변경하지 않고 분석 결과를 별도의 Frame으로 저장한다.

### Human Importance

사용자가 중요한 정보에 직접 중요도를 지정할 수 있어야 한다.

현재 기본 후보:

```text
Low
Normal
High
Critical
```

AI가 판단하는 논리적 강도와 사용자 중요도는 동일한 개념으로 취급하지 않는다.

MVP에서는 **사용자 중요도에 우선적으로 집중한다.**

### Clarification

AI가 중요한 모호성을 발견한 경우 사용자에게 clarification을 요청할 수 있다.

질문은 가능한 한 선택형으로 제공한다.

예:

```text
이 내용은 어떤 성격인가요?

[아이디어]
[결정]
[의견]
[질문]
[기타...]
```

`기타`를 선택하면 사용자가 자유롭게 자세한 답변을 작성할 수 있다.

Clarification은 Non-blocking과 Blocking으로 구분한다.

---

## 4.2 Out of Scope

10일 MVP에서는 다음을 의도적으로 제외한다.

- Personal RAG
- Vector Database
- Semantic Retrieval
- Personal MCP
- Agent Integration
- Multi-Agent Workflow
- Knowledge Graph
- 자동 사실 검증
- Evidence validity 평가
- 자동 논리적 강도 평가
- 복잡한 reasoning evaluation
- 자동 문서 재작성
- AI 기반 대규모 문서 요약
- 자동 Vault 폴더 재배치
- 범용 Obsidian AI Assistant 기능

Document Framer는 문서를 **구조화**하는 제품이며, 문서 내용의 진실이나 논리적 우수성을 판단하는 제품으로 확장하지 않는다.

---

## 4.3 Future Candidates

다음은 현재 방향과 관련되어 있지만 MVP 이후 검토한다.

- Personal RAG 연결
- Hybrid Retrieval
- Embedding / Vector Index
- Knowledge Graph
- Personal MCP
- AI Agent integration
- Deep Review
- 선택한 문서에 대한 고급 논리 분석
- 자동 fact verification
- 관련 Knowledge Unit 연결
- 중복 지식 탐지
- Knowledge lifecycle 관리

이 목록은 MVP scope가 아니며 change candidate로 취급한다.

---

# 5. Constraints

## 5.1 User Experience

사용자는 다음을 알 필요가 없어야 한다.

- Label taxonomy 구조
- Metadata schema
- Knowledge Unit 내부 구조
- AI model
- RAG 구조
- Frame 저장 방식

사용자의 기본 행동은 기존 Obsidian 사용 방식과 최대한 동일하게 유지한다.

> **Write → Paste → Save**

사용자에게 허용되는 주요 개입은 다음과 같다.

- 중요도 지정
- AI classification 수정
- AI clarification 응답

AI가 질문하는 경우 긴 자연어 입력을 기본으로 요구하지 않는다.

선택지를 우선 제공하고, 사용자가 필요할 경우에만 `기타`를 통해 자세한 내용을 작성한다.

---

## 5.2 Cost

Document Framer는 **Cheap by Default**를 핵심 원칙으로 한다.

분류 작업에 높은 비용의 frontier model을 기본적으로 사용하지 않는다.

가능한 경우 다음 순서를 지향한다.

```text
Deterministic Processing
        ↓
Rule-based Classification
        ↓
Cheap / Local Model
```

강력한 reasoning model을 ingestion의 기본 경로에 포함하지 않는다.

모델 baseline은 이후 사용자 결정에 따라 Gemini로 확정했으며, 품질·비용의 적합성은 실제 평가로 검증한다.

---

## 5.3 Knowledge

### Raw Content First

원본 Markdown은 지식의 Source of Truth다.

### Annotation is Derived Data

AI가 생성한 Frame과 label은 원본보다 낮은 권위를 가진 파생 데이터다.

모델이나 taxonomy가 변경되면 원본을 수정하지 않고 Frame을 다시 생성할 수 있어야 한다.

### Human Importance

사용자가 직접 지정한 Importance는 AI가 추정한 중요도보다 높은 권위를 가진다.

### Ask Instead of Guess

중요한 모호성을 AI가 확신 없이 추측하기보다 사용자에게 간단한 clarification을 요청할 수 있다.

---

## 5.4 Technical

현재 제품 요구사항 수준에서 확정된 기술적 제약은 다음과 같다.

- Obsidian과 호환되는 Markdown 문서를 입력으로 사용한다.
    
- 원본 Markdown을 classification 결과 때문에 강제로 수정하지 않는다.
    
- Frame은 원문과 분리되어 재생성 가능해야 한다.
    
- 초기 프로그램은 개인 사용 환경에서 충분히 가볍게 실행될 수 있어야 한다.
    

구체적인 언어, database, model, framework는 Step 1에서 결정하지 않는다.

---

# 6. Proposed Shape

## 6.1 Core Approach

Document Framer는 사용자가 저장한 비정형 Markdown을 읽어 deterministic metadata와 AI 기반 semantic annotation을 생성한다.

원본과 annotation은 분리한다.

AI는 문서를 다시 작성하는 것이 아니라 **Frame을 생성한다.**

```text
Raw Document
      │
      ├───────────────┐
      │               │
      ▼               ▼
Preserved Content   Framing Pipeline
                      │
                      ├─ Metadata
                      ├─ Segmentation
                      ├─ Domain
                      ├─ Semantic Labels
                      └─ Confidence
                              │
                              ▼
                            Frame
```

사용자는 필요할 때 Importance를 추가하거나 classification을 수정한다.

---

## 6.2 Essential Flow

1. 사용자가 Obsidian에 Markdown 문서를 작성하거나 붙여넣고 저장한다.
    
2. Document Framer가 해당 문서를 처리 대상으로 인식한다.
    
3. deterministic metadata와 문서 구조를 추출한다.
    
4. 문서를 Knowledge Unit으로 분리한다.
    
5. 저비용 classification을 통해 Domain과 Semantic Label을 생성한다.
    
6. classification 결과와 confidence를 Frame으로 저장한다.
    
7. 사용자는 Frame을 확인할 수 있다.
    
8. 필요한 경우 Importance를 지정하거나 classification을 수정한다.
    
9. 중요한 모호성이 있다면 AI가 선택형 clarification을 제공한다.
    
10. 수정 또는 답변 결과가 Frame에 반영된다.
    

---

# 7. Known Unknowns

## 7.1 Domain Taxonomy

분야 체계는 기본적으로 중복을 허용한다. 

최상위 분류에서 시작하되, 중위 분류를 거쳐, 하위 분류까지 연결되는 3단계 계층을 활용한다.

승인된 Domain Catalog를 먼저 검토하여 적절한 기존 분야를 우선 재사용한다. 비슷한 분야를 불필요하게 세분화하지 않고 기존 분야로 충분히 표현할 수 없을 때만 재사용 가능한 새 후보를 제안한다. 사용자 확인은 Non-blocking이며 승인·저장 성공한 후보만 Catalog에 추가한다. 거절·미응답 후보는 저장하거나 이후 Existing Domain으로 보내지 않는다. Other는 문서 의미 자체를 판단하기 어려울 때만 사용하며 Catalog 부재의 fallback이 아니다. multi-domain과 최대 3단계 경로를 유지한다.

---

## 7.2 Semantic Label Taxonomy

Semantic classification은 먼저 문서의 성격을 상위 수준에서 분류한 뒤,
필요한 경우 하위 Semantic Label을 적용하는 계층 구조를 사용한다.

초기 Document Type은 다음 네 가지 성격을 구분하는 것을 목표로 한다.

1. 주장-근거-결론의 구조를 가진 정보성 문서
2. 간단한 아이디어를 담은 메모
3. 산문·수필 형태이지만 프로젝트 또는 사용자의 중요한 결정이 포함된 문서
4. 산문·수필 형태이며 중요한 결정이 포함되지 않은 문서

4번을 제외한 1~3번은 문서의 성격에 따라 하위 Semantic Label을 적용할 수 있다.

예를 들어 정보성 문서는 다음과 같이 세분화할 수 있다.

- Claim
- Evidence
- Reasoning
- Conclusion

아이디어/메모는 다음과 같이 세분화할 수 있다.

- Idea
- Question
- Observation

중요한 결정이 포함된 문서는 다음과 같이 세분화할 수 있다.

- Decision
- Reflection
- Observation

하나의 Knowledge Unit에는 여러 Semantic Label이 동시에 적용될 수 있다.

구체적인 Label 구성과 계층은 Classifier Spike를 통해 조정한다.

---

## 7.3 Knowledge Unit Granularity

기본 classification 단위는 Document이다. 해당 문서를 저비용 AI를 통해 청킹하고, 각 청크를 분석한 뒤 class를 나눈다.

자세한 내용은 MVP개발을 진행하며 결정한다.

---

## 7.4 Classification Model

2026-09-15 사용자 결정에 따라 Gemini를 baseline으로 사용하며 현재 기본 모델은 gemini-3.1-flash-lite다.

Classifier Spike에서는 해당 모델을 baseline으로 사용하여
Document Framer에 필요한 Domain / Document Type / Semantic Label
classification 품질을 검증한다.

평가 항목은 다음과 같다.

- Classification Quality
- Structured Output Reliability
- Processing Cost
- Latency
- 주요 Failure Case

baseline이 MVP에 필요한 수준을 충족하지 못할 경우에만
다른 저비용 또는 로컬 모델을 비교 후보로 추가한다.

따라서 MVP의 기본 방향은 Gemini baseline이지만,
특정 모델에 대한 장기적인 종속을 제품 요구사항으로 두지는 않는다.

---

## 7.5 Frame Persistence

🟡 **결정 필요**

Frame을 어디에 어떤 방식으로 저장할지 결정하지 않았다.

중요한 요구사항은 저장 기술 자체가 아니라:

- Raw Markdown과 분리
    
- 재생성 가능
    
- 사용자 수정사항 보존
    
- taxonomy/model version 추적 가능
    

이라는 특성이다.

Step 3 Technical Design에서 구체적인 대안을 비교한다.

---

## 7.6 Clarification Trigger

**Non-blocking**

작업을 방해하지 않고 나중에 처리할 수 있는 질문.

**Blocking**

중요한 지식이며 잘못 분류될 경우 이후 동작에 큰 영향을 줄 수 있어 사용자 확인이 필요한 질문.

구체적인 trigger는 아직 결정하지 않는다.

---

## 7.7 Importance Granularity

사용자 중요도는 기본적으로 Document 단위에 적용한다.(점수 시스템. 10점 만점)

AI가 청킹으로 나누어 둔 단위에 대해 추가적인 중요도를 매길 수 있도록 한다.(하이라이트 표시 on/off를 통한 심플한 표식)

---

# 8. Risks & Rabbit Holes

## 8.1 Critical Risk — Cheap Model Quality

저렴하거나 로컬에서 실행 가능한 모델이 실제 비정형 문서를 충분히 잘 분류하지 못할 수 있다.

이는 Document Framer의 핵심 제품 가설에 직접 영향을 준다.

### Risk-Retirement

실제 사용 환경과 비슷한 작은 benchmark corpus를 만든다.

다음과 같은 서로 다른 문서를 포함한다.

- 직접 작성한 글
    
- AI 답변
    
- 웹에서 복사한 글
    
- 연구자료
    
- 프로젝트 문서
    
- 일기/회고
    
- 여러 성격이 섞인 문서
    

사람이 일부 ground truth를 작성한 뒤 후보 모델의 classification 결과를 비교한다.

---

## 8.2 Critical Risk — Taxonomy Ambiguity

실제 문장에서 Claim / Opinion / Conclusion / Decision 등이 명확하게 분리되지 않을 수 있다.

예:

> "나는 이 구조가 가장 좋다고 생각하고 앞으로 이렇게 구현할 것이다."

이는 Opinion이면서 Decision일 수도 있다.

따라서 MVP는 처음부터 완벽한 mutually-exclusive classification을 전제로 하지 않는다.

**Multi-label classification을 기본 방향으로 한다.**

---

## 8.3 Critical Risk — Classification Granularity

Knowledge Unit이 지나치게 작으면 inference 비용이 폭증하고, 지나치게 크면 semantic information이 손실된다.

따라서 segmentation 전략은 모델 benchmark와 함께 검증할 필요가 있다.

---

## 8.4 Rabbit Holes

10일 동안 특히 다음 방향으로 scope가 확장되는 것을 경계한다.

- 완벽한 taxonomy 설계
    
- 모든 학문 분야를 포괄하는 ontology 구축
    
- Vector DB 도입
    
- Knowledge Graph 구축
    
- Personal RAG까지 구현
    
- MCP 연결
    
- 여러 AI Agent 연결
    
- 완벽한 fact checking
    
- 논리 분석 시스템 구축
    
- 복잡한 Obsidian plugin 개발
    
- UI polish
    
- 모델 자체 fine-tuning
    
- 자동 문서 정리/재작성
    

좋은 아이디어가 발견되더라도 현재 scope에 자동으로 추가하지 않고 change candidate로 기록한다.

---

# 9. Risk-Retirement Action

본격적인 제품 구현 전에 가장 먼저 검증해야 할 질문은 다음과 같다.

> **저비용 모델이 실제 사용자가 축적하는 지저분하고 비정형적인 문서에서도 Domain과 Semantic Structure를 충분히 유용하게 분류할 수 있는가?**

이를 위해 작은 **Classifier Spike**를 수행한다.

```text
30–50 Sample Knowledge Units
           ↓
Human Labels
           ↓
Candidate Classifiers
           ↓
Quality
Cost
Latency
Failure Cases
           ↓
Decision
```

이 코드는 제품 코드로 간주하지 않는다.

Spike의 목적은 구현이 아니라 불확실성을 제거하는 것이다.

---

# 10. Shape Decision

## Confirmed

- 프로젝트명은 **Document Framer**다.
- MVP timebox는 **10일**이다.
- 기간을 늘리기보다 scope를 줄인다.
- Obsidian/Markdown 기반 문서를 대상으로 한다.
- Raw Markdown은 Source of Truth다.
- Frame은 재생성 가능한 annotation이다.
- 사용자는 taxonomy나 metadata 구조를 이해할 필요가 없다.
- deterministic metadata는 가능한 한 AI 없이 생성한다.
- Domain classification을 수행한다.
- Semantic classification을 수행한다.
- Semantic classification은 multi-label을 허용하는 방향으로 설계한다.
- 기본 classification은 Cheap-by-default다.
- 비싼 reasoning model을 기본 ingestion pipeline에 사용하지 않는다.
- 자동 논리적 강도 평가는 MVP에서 제외한다.
- 사용자 Importance를 우선한다.
- AI clarification은 Non-blocking / Blocking으로 구분한다.
- clarification은 선택형 응답을 우선한다.
- 사용자는 `기타`를 통해 자유롭게 답변할 수 있다.
- Personal RAG는 Document Framer MVP 범위 밖이다.
- Document Framer의 결과는 향후 Personal RAG의 입력 데이터로 활용한다.

- Domain classification은 3단계 계층 구조를 사용한다.
- Domain은 multi-label을 허용한다.
- 기존 taxonomy에 없는 Domain은 AI가 후보를 제안하고 사용자가 Non-blocking 방식으로 확인한다.
- Semantic classification은 Document Type → Semantic Label의 계층 구조를 기본 방향으로 한다.
- Document를 ingestion 및 상위 classification 단위로 사용한다.
- Document 내부는 Knowledge Unit으로 분할하여 Semantic Classification한다.
- MVP Classification Model의 baseline은 Gemini다.
- Document Importance는 1–10 점수로 표현한다.
- Knowledge Unit의 중요성은 Highlight on/off로 표현한다.

---

## Assumptions

### A-01

Document를 ingestion 및 상위 classification 단위로 사용하고,
하나의 Document를 하나 이상의 Knowledge Unit으로 분할하여
각 Knowledge Unit을 Semantic Classification의 기본 단위로 사용하는 것이
적절할 것으로 가정한다.

Knowledge Unit의 구체적인 segmentation 방식은 아직 확정하지 않는다.

Markdown Heading, paragraph, AI 기반 semantic chunking 등의 방법을
Classifier Spike 및 MVP 구현 과정에서 비교하고 결정한다.

### A-02

작거나 저렴한 모델로 Domain/Semantic classification을 충분한 수준까지 수행할 수 있을 것으로 가정한다.

Classifier Spike에서 검증한다.

### A-03

100% classification accuracy가 없어도 중요한 오류를 사용자가 쉽게 수정할 수 있다면 제품 가치가 존재한다고 가정한다.

---

## Open Decisions

1. 승인 Catalog의 의미상 재사용 품질·동의어/다국어·장기 관리 정책
2. Semantic Label Taxonomy v0.1의 실제 하위 Label
3. Knowledge Unit segmentation 방식
4. Frame persistence 방식
5. Clarification trigger의 구체적인 조건
6. Classification success threshold
7. Gemini baseline의 실제 분류 품질 합격 기준

---

## Blocking Decisions

현재 확인된 범위에서는 **Step 2 — Specify Observable Behavior로 넘어가는 것을 막는 미결정 사항은 없다.**

Taxonomy, 모델, 저장 기술 등의 세부 사항은 이후 specification 또는 technical design에서 결정하거나 spike를 통해 검증할 수 있다.

따라서 다음 단계에서는 구현 방법을 선택하기 전에 Document Framer의 사용자 및 시스템 행동을 `FR-xx`와 `AC-xx` 단위로 정의한다.

## 2026-09-15 Domain / Review 결정 반영

PRD S-02/S-06, FR-04/FR-11/FR-15, AC-04/AC-05/AC-12와 동일한 정책을 따른다. 기본 검토는 Domain·출처·Type·Unit 경계·Label·원문 중심이며 confidence와 JSON/평가 정보는 접힌 Developer Details에 둔다. Phase 2는 후보 승인 Catalog 저장만 추가하고 활성 Frame publication·전체 사용자 수정·Reframing·자동 실행은 후속 단계로 유지한다.
