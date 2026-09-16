# Document Framer — Framing Core 단순화 및 Content Nature 도입

이번 요청은 기존 PRD와 구현보다 우선하는 **새로운 사용자 결정**이다.

현재 Concept-Based Framing을 실제 Vault 문서에 적용해 본 결과, Evidence 기반 구조가 제품 목적에 비해 지나치게 복잡하며 실제 분류 품질도 좋지 않은 문제가 확인되었다.

이번 변경의 핵심은 다음과 같다.

```text
1. Evidence를 완전히 제거한다.
2. Semantic Evidence Label도 제거한다.
3. Key Concept은 문서의 semantic index 역할만 한다.
4. Concept 이름은 원문의 언어와 표현을 최대한 보존한다.
5. 기존 Document Type을 Content Nature로 교체한다.
6. information / opinion / mixed / unclassified를 구분한다.
7. 긴 문서 structural chunking과 Concept consolidation은 유지한다.
8. Domain lifecycle은 변경하지 않는다.
9. Gemini 503 transient error 대응을 제한적으로 강화한다.
```

단순히 기존 코드에 예외를 추가하지 말고, 불필요해진 Evidence 관련 구조를 제거하여 전체 architecture를 단순화한다.

---

# 1. 제품 정의 변경

Document Framer의 핵심 역할을 다음과 같이 정의한다.

> Document Framer는 Markdown 원문을 다시 구조화하거나 요약하는 시스템이 아니다.
> 문서가 어떤 지식 영역에 속하고, 어떤 성격의 글이며, 어떤 핵심 개념을 포함하는지를 나타내는 최소한의 semantic metadata를 생성하는 시스템이다.

Raw Markdown은 계속 Source of Truth다.

Frame은 최소한 다음 질문에 답한다.

```text
WHERE?
→ Domain

WHAT KIND?
→ Content Nature

WHAT ABOUT?
→ Key Concepts
```

---

# 2. 최종 Frame의 핵심 구조

개념적으로 다음 구조를 목표로 한다.

```ts
interface Frame {
  document: {
    // existing deterministic metadata

    domains: DomainClassification[];

    contentNature: ContentNatureClassification;
  };

  concepts: KnowledgeConcept[];
}
```

Concept은 단순하게 유지한다.

```ts
interface KnowledgeConcept {
  id: string;
  concept: string;
  confidence: number;
  highlight: boolean;
}
```

필요하다면 confidence는 현재처럼 내부 평가용으로 유지한다.

Concept에는 다음을 저장하지 않는다.

```text
evidence
blockIds
startLine
endLine
startOffset
endOffset
semantic labels
source excerpt
summary
```

---

# 3. Evidence 완전 제거

현재 Concept마다 Evidence를 요구하는 구조를 제거한다.

다음 구조는 폐기한다.

```text
Concept
 └─ Evidence
      ├─ blockIds
      ├─ line range
      ├─ offsets
      └─ labels
```

이유:

실제 문서에서는 하나의 Concept이 문서 전체에 걸쳐 설명되는 경우가 많다.

예를 들어 투자 독서록 전체가 `분산투자`, `효율적 시장 가설`, `위험` 등에 관련되어 있으면 Gemini가 매우 넓은 원문 영역을 Evidence로 선택할 수 있다.

이를 더 정교한 Evidence selection 문제로 해결하지 않는다.

MVP에서는 Evidence 자체를 제거한다.

Raw Markdown 전체가 해당 Frame의 source이므로 Concept → Document 관계만 유지한다.

---

# 4. Semantic Label 제거

다음 taxonomy도 Concept pipeline에서 제거한다.

```text
claim
evidence
conclusion
idea
observation
decision
context
unclassified
```

Evidence가 사라지므로 이 annotation 계층도 필요하지 않다.

관련:

* schema
* validator
* prompt
* merge logic
* UI
* tests
* PRD
* Project Brief

에서 제거한다.

다른 기능에서 LABELS가 사용되고 있다면 먼저 repository 전체 사용처를 확인하고 안전하게 제거한다.

---

# 5. Key Concept의 역할

Key Concept은 Knowledge Unit이나 요약문이 아니다.

Concept은:

> 이 문서가 어떤 핵심 개념들을 다루고 있는지를 나타내는 semantic index

다.

예:

```text
Domain
Finance → Investing

Content Nature
information

Key Concepts
- 효율적 시장 가설
- 분산투자
- 체계적 위험
- 비체계적 위험
- 베타
- 자본자산 가격결정 모형(CAPM)
- 재정가격결정 이론(APT)
- 행동재무학
- 스마트 베타
- 위험균등
```

---

# 6. Concept 언어 정책 — Source-Language-First

이 요구사항은 중요하다.

현재 한국어 문서를 Framing해도 Concept이 영어로 변환되는 경우가 있다.

앞으로 Concept 이름은 **원문의 언어와 표현을 최대한 그대로 보존**한다.

## 기본 우선순위

```text
1. 원문에 명시적으로 등장한 용어를 그대로 사용한다.

2. 동일 개념이 여러 형태로 등장하면
   문서에서 가장 자연스럽고 대표적으로 사용된 표현을 선택한다.

3. 원문에 명시적인 Concept 이름이 없어서 AI가 이름을 만들어야 한다면
   문서의 주 언어로 Concept 이름을 작성한다.

4. 다른 언어로 번역하거나 영어 canonical form으로 바꾸지 않는다.
```

---

# 7. 한국어 문서 처리

한국어가 주 언어인 문서에서는 일반적으로 한국어 Concept을 생성한다.

예:

```text
원문:
효율적 시장 가설에 따르면...

Concept:
효율적 시장 가설
```

다음처럼 임의로 번역하지 않는다.

```text
❌ Efficient Market Hypothesis
```

원문:

```text
분산투자를 통해 비체계적 위험을...
```

Concept:

```text
분산투자
비체계적 위험
```

다음처럼 바꾸지 않는다.

```text
❌ Diversification
❌ Unsystematic Risk
```

---

# 8. 원문에 영어가 존재하는 경우

원문 자체가 영어 전문용어를 사용한다면 그대로 유지한다.

예:

```text
ETF
Bitcoin
Transformer
RAG
CAPM
APT
```

이를 억지로 한국어로 번역하지 않는다.

---

# 9. 한국어 + 영문 약어

원문에 다음과 같이 쓰여 있다면:

```text
자본자산 가격결정 모형(CAPM)
```

가능하면 Concept도:

```text
자본자산 가격결정 모형(CAPM)
```

으로 유지한다.

원문이:

```text
CAPM
```

만 사용한다면:

```text
CAPM
```

을 그대로 사용한다.

AI가 임의로 표현을 확장하거나 번역하지 않는다.

---

# 10. Concept prompt의 영어 편향 제거

Concept extraction prompt에서 영어 Concept 예시만 사용하는 것을 피한다.

예를 들어 현재와 같은:

```text
Diversification
Systematic Risk
Efficient Market Hypothesis
```

만을 representative example로 제시하지 않는다.

필요하면 언어 중립적인 설명 또는 다국어 예시를 사용한다.

예:

```text
원문: "행동재무학"
→ Concept: "행동재무학"

원문: "Behavioral Finance"
→ Concept: "Behavioral Finance"
```

Prompt에 다음 규칙을 명시한다.

```text
PRESERVE SOURCE LANGUAGE

- Prefer an explicit term already present in the source.
- Do not translate a concept merely to normalize it.
- Do not convert Korean concepts into English canonical terms.
- Do not convert English technical terms into Korean unless the source does so.
- When a concept name must be inferred, use the dominant natural language of the source chunk/document.
```

---

# 11. Content Nature 도입

기존 Document Type taxonomy:

```text
informational
idea-note
prose-with-decision
prose-without-decision
unclassified
```

를 폐기한다.

대신:

```ts
type ContentNature =
  | "information"
  | "opinion"
  | "mixed"
  | "unclassified";
```

를 사용한다.

내부 enum은 영어로 유지해도 된다.

UI에서는 한국어로 표시한다.

```text
information  → 정보
opinion      → 의견
mixed        → 정보 + 의견
unclassified → 분류 어려움
```

---

# 12. information 정의

다음이 문서의 중심이면 `information`.

* 사실
* 개념
* 이론
* 설명
* 절차
* 참고자료
* 책/논문 내용 정리
* 외부 지식 기록

예:

```text
CAPM에서는 기대수익률을 무위험수익률과
시장 위험 프리미엄으로 설명한다.
```

작성자의 짧은 코멘트 한두 개가 포함되어 있다고
자동으로 mixed로 분류하지 않는다.

---

# 13. opinion 정의

다음이 문서의 중심이면 `opinion`.

* 작성자의 판단
* 주장
* 평가
* 해석
* 선호
* 개인적 견해

예:

```text
나는 개별주식 투자보다 ETF 투자가
대부분의 개인투자자에게 적합하다고 생각한다.
```

근거를 위해 사실 몇 개를 인용했다고
자동으로 mixed로 분류하지 않는다.

---

# 14. mixed 정의

`information`과 `opinion`이 모두 문서 이해에 실질적으로 중요한 경우에만 사용한다.

예:

```text
효율적 시장 가설에서는
지속적인 초과수익 창출이 어렵다고 본다.

나는 이를 고려했을 때
개인투자자는 인덱스 투자를 기본 전략으로 삼는 것이 좋다고 본다.
```

이 문서에서는 외부 정보와 작성자의 판단이 모두 핵심이므로:

```text
mixed
```

가 적합하다.

---

# 15. mixed 남용 금지

Prompt에 명시한다.

```text
Do not choose mixed merely because both information and opinion appear somewhere.

Choose the dominant nature when the secondary nature is minor.

Use mixed only when both are materially important to understanding the document.
```

예:

```text
정보 90% + 짧은 감상 10%
→ information

개인 의견 90% + 근거 사실 10%
→ opinion

정보와 의견이 모두 주요 내용
→ mixed
```

---

# 16. unclassified

다음과 같이 의미가 부족한 경우에만 사용한다.

```text
짧은 임시 메모
의미 없는 문자열
내용 부족
문맥 부족
```

분류가 어렵다는 이유만으로 쉽게 사용하지 않는다.

---

# 17. Decision / Idea를 Content Nature에 섞지 않는다

이번 버전에서는:

```text
decision
idea
question
reflection
```

등을 별도 taxonomy로 추가하지 않는다.

향후 필요하면 `signals`라는 독립 metadata로 추가할 수 있다.

이번 scope에서는 구현하지 않는다.

Change Candidate로만 기록한다.

---

# 18. Chunk-level processing

현재 구현된 Structural Chunking은 유지한다.

긴 문서는 계속:

```text
Document
→ Structural Chunks
→ Chunk-level AI extraction
→ Consolidation
→ Final Frame
```

으로 처리한다.

다만 각 chunk의 AI 출력은 단순해진다.

기존:

```text
domains
type
concepts
  └─ evidence
      └─ labels
```

새 구조:

```text
domains
contentNature
concepts
```

---

# 19. Chunk-level Concept schema

권장 schema:

```ts
{
  domains: DomainClassification[];

  contentNature: {
    id: "information" | "opinion" | "mixed" | "unclassified";
    confidence: number;
  };

  concepts: {
    concept: string;
    confidence: number;
  }[];
}
```

Concept는 zero-length array를 허용한다.

모든 chunk가 Concept을 생성할 필요는 없다.

---

# 20. Concept validation 단순화

Concept validation은 최소한 다음만 확인한다.

```text
- concepts가 array인지
- 개수가 budget 범위인지
- concept가 빈 문자열이 아닌지
- trim된 문자열인지
- 최대 길이를 넘지 않는지
- control / invisible character가 없는지
- confidence가 finite 0..1인지
```

Evidence 관련 검증은 모두 제거한다.

다음 검증은 더 이상 존재하지 않아야 한다.

```text
block ID 존재 여부
Evidence block 중복
연속 block 요구
Evidence group
Semantic Label validation
line range 생성
offset 생성
```

---

# 21. 오류 메시지 정리

현재와 같은:

```text
Concept 응답 검증 실패:
개념 이름·Evidence·후보 참조를 확인하세요.
```

는 Evidence 제거 후 더 이상 적절하지 않다.

새 오류는 실제 검증 실패 원인을 반영한다.

예:

```text
Concept 응답 검증 실패:
개념 이름 또는 confidence 형식을 확인하세요.
```

가능하면 developer log에서는 구체적인 validation reason을 남기되,
사용자 UI는 짧고 이해 가능한 메시지를 보여준다.

모델이 잘못된 응답을 반환한 경우 source document 자체의 오류처럼 표현하지 않는다.

---

# 22. Concept exact duplicate merge 유지

현재 normalized exact duplicate merge 아이디어는 유지한다.

정규화는 다음 정도만 허용한다.

```text
Unicode NFC
case normalization
whitespace normalization
```

그러나 **번역을 사용한 normalization은 하지 않는다.**

예:

```text
행동재무학
Behavioral Finance
```

를 코드가 동일 Concept이라고 자동으로 판단하지 않는다.

언어가 다르면 기본적으로 별도 Concept으로 취급한다.

---

# 23. Semantic consolidation 유지

여러 chunk에서 유사 Concept이 나오면 현재처럼 semantic consolidation을 사용할 수 있다.

하지만 consolidation prompt에도 언어 보존 규칙을 추가한다.

예:

```text
candidate 1:
분산투자

candidate 2:
포트폴리오 분산

→ 대표 Concept을 한국어 후보 중 선택
```

다음처럼 바꾸지 않는다.

```text
❌ Diversification
```

Consolidation 모델은 가능하면 기존 candidate 이름 중 하나를 선택한다.

새 이름을 생성해야 하는 경우에도 문서의 주 언어를 따른다.

---

# 24. Consolidation에 document language hint 전달

필요하면 chunk/document에서 간단한 `languageHint`를 얻어
consolidation input에 전달할 수 있다.

하지만 별도의 복잡한 language detection dependency를 추가하지 않는다.

우선 prompt가 실제 candidate names를 보면서 언어를 보존하도록 한다.

필요한 경우 아주 단순한 deterministic heuristic을 사용해도 되지만
새 라이브러리를 추가하지 않는다.

---

# 25. 최종 Document Content Nature

여러 chunk가 존재하는 경우
최종 Content Nature는 chunk 결과를 단순 majority vote로 결정하지 않는다.

현재 document-level classification call과 유사하게
전체 chunk signal을 보고 최종 분류하도록 한다.

입력 예:

```json
{
  "chunks": [
    {
      "contentNature": "information",
      "concepts": ["효율적 시장 가설", "분산투자"]
    },
    {
      "contentNature": "mixed",
      "concepts": ["행동재무학"]
    }
  ]
}
```

최종적으로 문서 전체의 성격을 판정한다.

---

# 26. Domain lifecycle 유지

현재 이미 검증된 다음 흐름은 변경하지 않는다.

```text
Existing Domain reuse
New Domain proposal
User approval
Domain persistence
```

Domain prompt와 validation은
Content Nature 변경 때문에 불필요하게 재작성하지 않는다.

---

# 27. 503 오류 대응 강화

현재 503 등 transient server error가 실제 사용 중 반복적으로 발생한다.

Gemini client에서 transient HTTP 상태:

```text
408
500
502
503
504
```

에 대한 retry budget을:

```text
최대 3 attempts
```

로 변경한다.

즉:

```text
Initial request
+
최대 2회 retry
```

다.

무한 재시도는 금지한다.

---

# 28. Retry delay

현재 고정 1초 retry 대신
bounded exponential backoff + small jitter를 사용한다.

예시 목표:

```text
1차 실패
→ 약 1~2초

2차 실패
→ 약 3~5초

3차 실패
→ 사용자에게 오류 반환
```

구체적인 숫자는 상수로 관리한다.

예:

```ts
const RETRY_BASE_MS = 1500;
const MAX_HTTP_ATTEMPTS = 3;
```

jitter는 작은 random 범위로 추가한다.

목적은 동시에 재시도하는 client가 정확히 같은 시점에 다시 요청하는 것을 줄이는 것이다.

---

# 29. Retry 대상

자동 retry:

```text
network failure
408
500
502
503
504
```

기존 철학을 유지한다.

`429`는 이번 변경에서 무조건 transient set에 넣지 않는다.

429는:

```text
rate limit
quota
billing
usage limit
```

등일 가능성이 있으므로
현재처럼 사용자에게 요청/사용량/결제 한도를 확인하도록 안내한다.

Retry-After 등 명시적인 지원을 추가하려면 별도 Change Candidate로 기록한다.

---

# 30. Timeout semantics 유지

현재 timeout 이후 실제 HTTP 연결 종료 여부가 불명확한 상태를
안전하게 다루는 로직은 유지한다.

Retry 개선 때문에 timeout safety나 unresolved-attempt recovery를 깨뜨리지 않는다.

Gemini transport layer 전체를 다시 작성하지 않는다.

---

# 31. Processing Budget 업데이트

현재 budget에 `maxHttpAttempts` 등이 있다면
새 retry 최대치와 실제 worst-case request count가 일치하도록 갱신한다.

예:

```text
logical request 최대 34
HTTP attempt 최대 logicalRequests × 3
```

처럼 실제 계산과 UI 안내가 맞아야 한다.

고정 숫자를 서로 다른 파일에 중복 작성하지 않는다.

---

# 32. Output token 감소 기대

Evidence와 label이 사라지므로
Gemini response schema와 output이 크게 줄어든다.

이를 이용해 불필요하게 `maxOutputTokens`를 바로 낮추지는 않는다.

먼저 실제 usage 기록을 수집한다.

Generation config 조정은 이번 변경과 분리한다.

---

# 33. Frame Schema version

현재 Gemini Concept Frame이 기존 Evidence schema를 사용하고 있다면
새 schema version으로 명확히 올린다.

예:

```text
schemaVersion: 5
```

실제 번호는 repository의 version history를 확인해 충돌 없이 결정한다.

새 Frame과 이전 Evidence 기반 Frame을 동일 schema version으로 저장하지 않는다.

---

# 34. 기존 Frame migration

기존 Evidence 기반 Concept Frame을
새 Frame으로 자동 변환할 수 있는 경우:

```text
concept name
confidence
highlight
```

만 안전하게 가져오는 lightweight migration은 허용한다.

Evidence와 labels는 폐기한다.

하지만 migration 복잡도가 높으면
legacy Frame으로 읽고 재-Framing을 요구해도 된다.

이미 존재하는 사용자 annotation을 조용히 잃는 migration은 하지 않는다.

현재 저장 데이터의 실제 상태를 먼저 확인한다.

---

# 35. UI 변경

Frame Review에서 Concept은 다음 정도만 보여준다.

```text
Domain
Finance → Investing

Content Nature
정보

Key Concepts
- 효율적 시장 가설
- 분산투자
- 체계적 위험
- CAPM
- 행동재무학
```

더 이상 Concept 아래에:

```text
Evidence
source excerpt
line range
semantic labels
```

를 보여주지 않는다.

---

# 36. Content Nature UI

사용자에게 enum raw value 대신 다음을 표시한다.

```text
information  → 정보
opinion      → 의견
mixed        → 정보 + 의견
unclassified → 분류 어려움
```

Developer Details에는 raw JSON을 표시해도 된다.

---

# 37. Highlight 유지

기존 Concept Highlight는 유지한다.

사용자가:

```text
이 Concept은 특히 중요함
```

을 표시할 수 있는 구조는 계속 지원한다.

---

# 38. Confidence

Confidence는 유지해도 되지만
Primary UI에서 강조하지 않는다.

Confidence는 모델 자체 평가일 뿐
정확성 확률이 아니다.

Developer Details 또는 보조 정보로만 취급한다.

---

# 39. PRD 수정

현재 문서에서 다음 개념을 찾아 새 구조와 일치하도록 수정한다.

특히:

```text
Document Type Classification
Knowledge Concept Extraction
Evidence Linking
Semantic Classification
Knowledge Unit / Concept Highlight
Frame Generation
Human Correction
Acceptance Criteria
Open Decisions
Edge Cases
```

Evidence 관련 requirement와 acceptance criterion은 제거하거나 새 방향으로 재작성한다.

단순히 용어만 바꾸지 않는다.

observable behavior를 새 제품 정의와 맞춘다.

---

# 40. Project Brief 수정

제품 핵심을 다음 방향으로 정리한다.

기존:

```text
Concept + Evidence Linking
```

에서:

```text
Domain Classification
+
Content Nature Classification
+
Key Concept Indexing
```

으로 변경한다.

---

# 41. MVP Plan 수정

Concept-Based Framing 단계의 학습 결과를 기록한다.

예:

```text
Evidence linking was tested and intentionally removed.

Reason:
document-wide concepts made evidence spans excessively broad,
and the complexity did not provide enough MVP value.
```

역사적 결정을 삭제하지 말고
왜 단순화했는지 남긴다.

---

# 42. Prompt versioning

최소 다음 version을 올린다.

```text
concept extraction prompt
document classification prompt
concept extraction schema
document classification schema
pipeline version
```

Consolidation prompt도 source-language rule이 변경되므로 version을 올린다.

Evaluation trace에서 새 version을 확인할 수 있어야 한다.

---

# 43. Tests — Source language

다음 테스트를 추가한다.

## Korean source

입력:

```text
효율적 시장 가설과 분산투자에 대해 설명한다.
```

Concept 결과가 다음과 같은 한국어 표현을 허용/기대한다.

```text
효율적 시장 가설
분산투자
```

영어 번역을 prompt expectation으로 사용하지 않는다.

---

# 44. Tests — English source

입력:

```text
This note explains Behavioral Finance and Risk Parity.
```

Concept은 영어 표현을 유지해야 한다.

---

# 45. Tests — Korean + acronym

입력:

```text
자본자산 가격결정 모형(CAPM)을 이용한다.
```

Concept 이름이 원문의 표현을 보존할 수 있어야 한다.

---

# 46. Tests — Evidence 없는 Concept

다음 응답은 정상 validation을 통과해야 한다.

```json
{
  "concepts": [
    {
      "concept": "분산투자",
      "confidence": 0.9
    }
  ]
}
```

Evidence가 없다는 이유로 실패하면 안 된다.

---

# 47. Tests — Content Nature

최소 다음을 테스트한다.

```text
pure factual explanation
→ information

personal argument
→ opinion

substantial factual explanation + substantial personal judgment
→ mixed

meaningless/insufficient content
→ unclassified
```

---

# 48. Tests — mixed 남용 방지

다음 유형의 fixture를 추가한다.

```text
긴 정보 문서 + 마지막 한 줄 개인 감상
→ information
```

그리고:

```text
긴 개인 의견 + 짧은 사실 인용
→ opinion
```

Prompt evaluation fixture로 두어도 된다.

---

# 49. Tests — Concept validation

다음은 실패:

```text
empty concept
whitespace-only concept
control characters
confidence outside 0..1
too many concepts
```

다음은 더 이상 테스트하지 않는다.

```text
invalid evidence block ID
non-contiguous evidence
duplicate evidence block
invalid semantic label
```

해당 코드 자체를 제거한다.

---

# 50. Tests — 503 retry

Gemini transport mock으로 확인한다.

## Case A

```text
503
→ 200
```

성공.

## Case B

```text
503
→ 503
→ 200
```

성공.

## Case C

```text
503
→ 503
→ 503
```

최종 실패.

## Case D

```text
400
```

자동 retry 없음.

## Case E

```text
429
```

현재 정책대로 자동 retry 하지 않음.

---

# 51. Retry 테스트에서 실제 sleep 금지

Unit test에서는 실제 수 초를 기다리지 않는다.

현재 GeminiClient가 sleep dependency를 주입받을 수 있는 구조라면
그 구조를 유지하여 fake sleep으로 검증한다.

jitter도 deterministic injection이 필요하면
작은 dependency로 분리한다.

production code를 과도하게 추상화하지 않는다.

---

# 52. Regression

반드시 다음 기능을 회귀 테스트한다.

```text
Domain reuse
New Domain proposal
Domain approval
Domain persistence

Structural long-document chunking
Exact Concept duplicate merge
Semantic Concept consolidation

Gemini timeout handling
Attempt Journal
Usage metadata
SecretStorage
Stale result rejection
Source hash/evaluation trace
Frame persistence
```

---

# 53. 이번 변경에서 하지 않을 것

다음을 추가하지 않는다.

```text
Embeddings
Vector DB
Concept graph
Ontology
Keyword translation table
Multilingual synonym database
Automatic language translation
Evidence scoring
Sentence-level evidence extraction
Fact verification
Summary generation
Decision/Idea signals
RAG implementation
```

필요성이 발견되면 Change Candidate로만 기록한다.

---

# 54. 코드 수정 원칙

Repository에 TypeScript source가 존재한다면
bundled `main.js`를 직접 source of truth로 수정하지 않는다.

다음과 같은 실제 source module을 수정하고
정상 build를 통해 `main.js`를 재생성한다.

예상 관련 파일:

```text
src/classification.ts
src/classification-prompt.ts
src/concept-prompts.ts
src/concepts.ts
src/framing.ts
src/gemini.ts
src/budget.ts
src/main.ts
관련 UI module
관련 tests
```

실제 repository 구조를 먼저 확인한다.

---

# 55. 권장 구현 순서

```text
1. 현재 source/tests/docs 확인

2. PRD / Brief / Plan 변경

3. Content Nature taxonomy 도입

4. Evidence + Semantic Label schema 제거

5. Concept validator 단순화

6. Source-language-first extraction prompt

7. Source-language-preserving consolidation prompt

8. Framing orchestration 정리

9. Frame schema version 변경

10. Review UI 단순화

11. 503 retry/backoff 강화

12. Processing budget 갱신

13. Tests

14. Build

15. Documentation reconciliation
```

---

# 56. 최종 완료 조건

다음이 모두 만족되어야 한다.

```text
한국어 문서에서
한국어 Concept이 자연스럽게 생성된다.

원문 영어 용어는 영어 그대로 유지된다.

Concept에 Evidence가 존재하지 않는다.

Evidence 관련 validation 오류가 사라진다.

Semantic Evidence Label이 Frame에서 제거된다.

Document가
information / opinion / mixed / unclassified
중 하나로 분류된다.

mixed가 사소한 정보/의견 혼재 때문에 남용되지 않는다.

긴 문서는 기존 structural chunking으로 계속 처리된다.

chunk 간 Concept 중복은 계속 통합된다.

Domain lifecycle은 그대로 정상 작동한다.

503 transient failure는
최대 3 attempts 내에서 bounded backoff 후 재시도된다.

영구 오류나 429를 무한 재시도하지 않는다.

저장된 Frame schema와 UI가 새 구조와 일치한다.
```

---

# 57. 작업 완료 보고

작업 완료 후 다음 순서로 보고한다.

1. 기존 Evidence 구조에서 제거한 부분
2. 새 Frame schema
3. Content Nature taxonomy
4. Source-language-first Concept 규칙
5. Concept extraction prompt 변경
6. Concept consolidation 변경
7. validator 단순화
8. 503 retry/backoff 변경
9. Processing budget 변경
10. 저장/migration 변경
11. UI 변경
12. 수정한 문서
13. 수정한 source files
14. 추가/수정한 tests
15. 실행한 verification commands
16. build/test 결과
17. 아직 남은 Open Decisions
18. 구현하지 않은 Change Candidates

추가 기능을 임의로 확장하지 않는다.
