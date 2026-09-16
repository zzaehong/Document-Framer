# Document Framer — Markdown-Aware Phase 1 Structural Framing 재설계

이번 요청은 현재 구현보다 우선하는 새로운 사용자 결정이다.

이번 작업의 목적은 **AI를 사용하지 않는 Phase 1 Framing을 Markdown-aware structural processing layer로 재설계하는 것**이다.

단순히 문서 통계를 저장하는 수준이 아니라, 사용자가 Markdown을 통해 이미 표현한 문서 구조를 최대한 보존하여 이후 Phase 2 AI가 긴 문서를 읽을 때 **내용의 흐름이 중간에서 끊기지 않도록 context를 구성할 수 있는 기반**을 만든다.

이번 작업에서는 Phase 2의 Content Nature 정확도 개선, Human Review, Grounding-aware AI classification은 구현하지 않는다.

우선 Phase 1 structural pipeline을 완성한다.

---

# 1. 핵심 제품 정의

Phase 1과 Phase 2의 역할을 다음처럼 명확하게 구분한다.

```text
Phase 1
Observation / Structure

"문서에 실제로 어떤 구조가 존재하는가?"

↓

Phase 2
Interpretation / Semantics

"이 문서가 무엇을 의미하는가?"
```

Phase 1은 AI를 사용하지 않는다.

Phase 1의 핵심 정의:

> Markdown 작성자가 이미 표현한 구조를 deterministic하게 해석하고,
> 원문의 논리적 흐름을 최대한 보존한 structural representation을 생성한다.

그리고 이 구조를 이용해 Phase 2 실행 시
AI가 읽기 좋은 Context Unit을 생성할 수 있어야 한다.

---

# 2. Phase 1은 Markdown-aware compiler처럼 동작한다

Phase 1은 단순 metadata extractor가 아니다.

개념적으로:

```text
Raw Markdown
      ↓
Markdown-aware Parsing
      ↓
Structural Frame
      ├─ Document Metadata
      ├─ Section Tree
      ├─ Structural Blocks
      ├─ Structural Statistics
      └─ Grounding Signals
      ↓
Context Builder
      ↓
AI Context Units
```

여기서 중요한 구분:

```text
Structural Frame
= 저장되는 deterministic artifact

AI Context Unit
= Phase 2 실행 시 필요에 따라 생성하는 모델 입력 단위
```

둘을 동일한 개념으로 만들지 않는다.

---

# 3. 기존 Local Test Frame 제거

현재:

```text
engine: local-test-v1

domains: []
type: null
confidence: null

knowledgeUnits:
- entire document
- TEST_ONLY
```

구조를 제거한다.

다음 legacy 요소를 local frame에서 삭제한다.

```text
local-test-v1
TEST_ONLY
knowledgeUnits
semantic labels
domains: []
type: null
confidence: null
```

AI semantic processing을 실행하지 않았다는 사실은 명시적으로 표현한다.

예:

```json
{
  "semantic": {
    "status": "not-run"
  }
}
```

---

# 4. 새 Engine

새 local engine:

```text
local-structural-v1
```

을 사용한다.

이 결과는 더 이상 테스트 fixture가 아니라
정식 Phase 1 artifact다.

---

# 5. 가장 중요한 원칙 — Markdown 구조 우선

Context를 만들 때 단순 byte size를 최우선 기준으로 사용하지 않는다.

우선순위는 다음과 같다.

```text
Markdown semantic structure
        ↓
Heading hierarchy
        ↓
Section boundary
        ↓
Paragraph / List / Quote / Table / Code block
        ↓
size budget
```

즉:

> 먼저 의미적으로 완전한 Markdown 단위를 만들고,
> 그 단위가 모델 budget을 초과할 때만 더 작은 구조로 분해한다.

---

# 6. Heading은 Section Hierarchy다

다음 문서:

```markdown
# 투자 이론

서론

## 효율적 시장 가설

본문

### 약형 효율성

본문

### 강형 효율성

본문

## 행동재무학

본문
```

을 단순 heading 배열로만 보지 않는다.

다음과 같은 계층으로 해석한다.

```text
투자 이론
├─ intro
├─ 효율적 시장 가설
│  ├─ 본문
│  ├─ 약형 효율성
│  └─ 강형 효율성
└─ 행동재무학
```

---

# 7. Section Tree

각 Section은 최소 다음 정보를 가진다.

```ts
interface SectionInfo {
  id: string;

  level: number;

  title: string | null;

  headingPath: string[];

  startLine: number;
  endLine: number;

  startOffset: number;
  endOffset: number;

  byteLength: number;

  blockIds: string[];
}
```

예:

```json
{
  "id": "section-4",
  "level": 3,
  "title": "약형 효율성",

  "headingPath": [
    "투자 이론",
    "효율적 시장 가설",
    "약형 효율성"
  ],

  "startLine": 18,
  "endLine": 31,

  "blockIds": [
    "block-14",
    "block-15"
  ]
}
```

---

# 8. Section 범위 규칙

Heading Section의 범위는 deterministic해야 한다.

기본 규칙:

```text
현재 heading
→ 다음 동일 level 또는 상위 level heading 직전
```

예:

```markdown
## A

text

### A-1

text

### A-2

text

## B
```

`A` Section은 개념적으로 B 직전까지의 subtree를 포함할 수 있다.

다만 실제 block membership을 중복 저장하면 복잡해질 수 있으므로:

```text
Section Tree hierarchy
+
direct blocks
```

구조를 사용하는 것도 허용한다.

Codex는 구현 전에 section semantics를 명확히 결정하고
tests로 고정한다.

중요 조건:

```text
같은 입력
→ 항상 같은 Section Tree
```

여야 한다.

---

# 9. Heading Path

Phase 2에서 일부 문서만 읽더라도
상위 문맥을 잃지 않도록 모든 section에:

```text
headingPath
```

를 제공한다.

예:

```text
투자 이론
→ 효율적 시장 가설
→ 약형 효율성
```

이 정보는 긴 문서 처리에서 중요하다.

---

# 10. Structural Block

Section 아래에는 Markdown structural block을 만든다.

권장 block 종류:

```ts
type StructuralBlockKind =
  | "paragraph"
  | "heading"
  | "list"
  | "blockquote"
  | "code"
  | "table"
  | "frontmatter"
  | "horizontal-rule";
```

현재 repository parser 구조와 맞지 않는 항목은 조정할 수 있다.

---

# 11. Paragraph

빈 줄 등 Markdown 문단 경계를 기준으로
연속 prose를 하나의 paragraph block으로 취급한다.

중요:

```text
Paragraph
≠ AI request 하나
```

Paragraph는 **Context를 더 이상 쉽게 쪼개지 않기 위한 atomic structural unit**이다.

기본 AI Context는 Section이다.

---

# 12. List는 하나의 Block으로 유지

예:

```markdown
분산투자의 장점:

1. 위험 감소
2. 기업 의존도 감소
3. 변동성 감소
4. 위험 대비 수익률 개선
```

이 목록 전체를 가능한 한 하나의 structural block으로 유지한다.

다음은 피한다.

```text
Context A
1.
2.

Context B
3.
4.
```

ordered / unordered list 모두 적용한다.

nested list도 가능하면 하나의 list structure로 보존한다.

---

# 13. Blockquote

연속된 Markdown quote:

```markdown
> 첫 번째 문장
> 두 번째 문장
> 세 번째 문장
```

을 하나의 quote block으로 처리한다.

줄마다 별도 block으로 만들지 않는다.

---

# 14. Code Block

Fenced code:

````markdown
```ts
const value = 1;
```
````

전체를 하나의 atomic block으로 유지한다.

정상적인 상황에서는 code fence 내부를 split하지 않는다.

Code 내부의:

```text
#
-
|
>
```

등을 Markdown heading/list/table로 오해하지 않는다.

---

# 15. Table

GFM-style Markdown table은 가능한 경우 하나의 atomic block으로 유지한다.

예:

```markdown
| 지표 | 값 |
|---|---:|
| A | 10 |
| B | 20 |
```

행 중간에서 split하지 않는다.

새로운 완전한 Markdown parser를 작성할 필요는 없다.

현재 구현에서 안정적으로 탐지할 수 있는 table만 지원한다.

---

# 16. Frontmatter

YAML frontmatter:

```markdown
---
author: ...
source: ...
tags:
  - ...
---
```

는 별도의 metadata block으로 처리한다.

본문 paragraph로 취급하지 않는다.

Phase 2 Concept extraction에서 frontmatter가 일반 본문처럼 과도한 영향을 주지 않도록
구분되어 있어야 한다.

---

# 17. Horizontal Rule

Markdown horizontal rule:

```markdown
---
```

단 frontmatter가 아닌 경우,

```text
weak structural boundary
```

로 사용할 수 있다.

강제 Section Heading은 아니다.

Context builder에서 자연스러운 split 후보로 활용할 수 있다.

---

# 18. Heading 없는 문서

Heading이 하나도 없는 문서도 정상 처리한다.

이 경우 root section을 만든다.

예:

```json
{
  "id": "section-root",
  "level": 0,
  "title": null,
  "headingPath": [],
  "startLine": 1,
  "endLine": 150
}
```

그 아래 paragraph/list/etc structural blocks를 연결한다.

---

# 19. Structural Frame 권장 Shape

개념적으로 다음 형태를 목표로 한다.

```ts
interface StructuralFrame {
  schemaVersion: number;

  engine: "local-structural-v1";

  generatedAt: string;

  document: {
    path: string;
    title: string;

    createdAt: number;
    modifiedAt: number;

    bytes: number;
    lineCount: number;
  };

  structure: {
    sections: SectionInfo[];

    blocks: StructuralBlock[];

    stats: StructuralStats;
  };

  groundingSignals: GroundingSignals;

  semantic: {
    status: "not-run";
  };
}
```

---

# 20. 원문 전체를 Frame에 복제하지 않는다

Structural Frame은 Raw Markdown을 복제하는 저장소가 아니다.

Block에는 가능하면:

```text
startLine
endLine
startOffset
endOffset
```

을 저장하고,

실제 text는 필요할 때 Raw Markdown에서 가져온다.

Source of Truth:

```text
Raw Markdown
```

원칙을 유지한다.

---

# 21. Structural Statistics

AI 없이 안정적으로 계산 가능한 항목만 저장한다.

예:

```ts
interface StructuralStats {
  headingCount: number;
  sectionCount: number;

  paragraphCount: number;
  listCount: number;

  blockquoteCount: number;
  codeBlockCount: number;

  tableCount: number;

  linkCount: number;
  externalLinkCount: number;
}
```

필요 이상으로 heuristic stats를 추가하지 않는다.

---

# 22. Grounding Signals

Phase 1에서 deterministic하게 확인 가능한 grounding signal은 계속 수집한다.

예:

```ts
interface GroundingSignals {
  externalLinkCount: number;

  footnoteReferenceCount: number;

  blockquoteCount: number;

  tableCount: number;

  referenceSectionCount: number;

  sourceMetadataKeys: string[];
}
```

Grounding Signal은:

```text
Information 판정
```

이 아니다.

단순 관찰값이다.

---

# 23. Phase 2 Context Builder 도입

Structural Frame과 별도로
Phase 2를 위한 Context Builder를 구현한다.

예:

```ts
buildContextUnits(
  source: string,
  structuralFrame: StructuralFrame,
  budget: ContextBudget
): ContextUnit[]
```

정확한 API는 repository style에 맞춘다.

---

# 24. Context Unit은 저장되는 Knowledge Unit이 아니다

매우 중요하다.

```text
Context Unit
```

은 Gemini 입력을 위한 processing artifact다.

영구 Knowledge Unit이 아니다.

따라서 기존의:

```text
knowledgeUnits
```

개념을 부활시키지 않는다.

---

# 25. Context Unit 생성 우선순위

Context Builder는 다음 순서를 따른다.

```text
1. Section 전체가 budget에 들어가는지 확인

2. 들어가면 Section 전체를 하나의 Context Unit으로 사용

3. 너무 크면 child Section 기준으로 분할

4. child Section으로도 해결되지 않으면
   structural block 단위로 분할

5. block도 너무 크면
   안전한 내부 boundary 사용

6. 정말 마지막 수단에서만
   sentence / line boundary 사용
```

핵심:

> Byte limit은 처음부터 문서를 자르는 기준이 아니라,
> 의미 구조 보존 후 적용되는 최후의 제약이다.

---

# 26. Section 전체를 가능한 한 유지

예:

```markdown
## CAPM

CAPM은 ...

베타는 ...

베타가 높으면 ...

따라서 ...
```

전체가 budget 안에 들어간다면
하나의 Context Unit으로 유지한다.

문단마다 Gemini 요청을 만들지 않는다.

---

# 27. Parent Heading Context 복원

Child Section을 독립 Context Unit으로 보낼 경우
부모 Heading 경로를 함께 제공한다.

예:

Raw section:

```markdown
### 강형 효율성

강형 효율성 시장에서는...
```

AI Context에는 가능하면:

```markdown
# 투자 이론
## 효율적 시장 가설
### 강형 효율성

강형 효율성 시장에서는...
```

형태로 전달한다.

즉 모델이 현재 내용이 문서 전체에서 어디에 위치하는지 알 수 있어야 한다.

---

# 28. Context Wrapper와 Source Text 구분

부모 Heading을 Context Unit에 복원할 때
원문을 변조하지 않는다.

예를 들어 내부 표현은:

```ts
interface ContextUnit {
  id: string;

  sectionId: string;

  headingPath: string[];

  sourceRanges: SourceRange[];

  renderedMarkdown: string;
}
```

처럼 할 수 있다.

`renderedMarkdown`은 AI를 위한 context representation이며
Raw Markdown 자체를 수정하거나 저장하지 않는다.

---

# 29. Markdown 형태를 AI에게 적극적으로 유지

2단계 Gemini input에서 가능한 한:

```json
{
  "headingContext": [...],
  "blocks": [...]
}
```

만 전달하는 것보다,

필요한 경우 Markdown hierarchy를 사람이 읽는 것처럼 재구성한:

```markdown
# 투자 이론
## 효율적 시장 가설
### 강형 효율성

...
```

형태를 함께 사용하는 것을 검토한다.

목표:

> 모델이 특별한 metadata schema를 이해하지 않아도
> Markdown 구조 자체를 통해 문맥을 파악할 수 있게 한다.

단 Structured Output input contract가 복잡해지지 않도록
현재 Gemini pipeline과 가장 단순하게 결합되는 방식을 선택한다.

---

# 30. Context 내 block order 보존

Context Unit 내부 source block은 반드시 원문 순서를 유지한다.

```text
paragraph 1
list
paragraph 2
quote
```

를 임의로 재배열하지 않는다.

Phase 1은 문서를 요약하거나 재구성하는 단계가 아니다.

---

# 31. Context 간 순서도 보존

생성되는 Context Units도 원문 순서를 따른다.

```text
Context 1
Context 2
Context 3
```

의 순서가 원문 Section 순서와 일치해야 한다.

---

# 32. Overlap 기본 금지

기본적으로 Context Unit끼리 본문을 중복 전달하지 않는다.

Context overlap을 통해 문맥을 유지하려 하지 않는다.

대신:

```text
parent heading path
section structure
```

를 이용한다.

추후 overlap이 필요하다면 Change Candidate로 남긴다.

---

# 33. 아주 큰 Paragraph

하나의 paragraph 자체가 모델 budget보다 큰 경우에만
내부 split을 허용한다.

우선순위:

```text
sentence boundary
↓
line boundary
↓
Unicode-safe hard split
```

가능하면 문장 경계를 사용하되
새 복잡한 NLP dependency를 추가하지 않는다.

한국어 문장도 완벽하게 분석하려 하지 않는다.

간단하고 deterministic해야 한다.

---

# 34. 아주 큰 List

List 전체가 budget을 초과하면
최상위 list item 경계를 기준으로 분할할 수 있다.

하지만:

```text
한 list item 자체
```

는 가능한 한 유지한다.

Nested child item은 부모와 함께 유지하려 노력한다.

---

# 35. 아주 큰 Code Block / Table

단일 Code Block 또는 Table이 budget보다 큰 경우
의미 보존과 API budget이 충돌한다.

이 경우 silent truncation하지 않는다.

정책을 명확히 정의한다.

MVP 권장:

```text
Oversized atomic block
→ explicit framing error
```

또는 안전한 block-specific split이 명확할 경우에만 split한다.

임의 byte slicing은 하지 않는다.

---

# 36. 기존 structuralChunks() 재설계

현재 `structuralChunks()`는:

```text
extract blocks
→ oversized block byte split
→ heading-aware packing
→ byte/block limit flush
```

방식이다.

이 로직을 그대로 확장만 하지 않는다.

역할을 분리한다.

권장 구조:

```text
parseMarkdownStructure()
        ↓
StructuralFrame

buildContextUnits()
        ↓
ContextUnit[]

prepareGeminiInput()
```

---

# 37. Parser와 Context Builder 분리

가능하면:

```text
Markdown parser
```

와:

```text
AI context packing
```

을 별도 module로 분리한다.

이유:

Structural Frame은 안정적인 문서 구조이고,

Context packing은:

```text
model
context budget
prompt design
```

에 따라 바뀔 수 있기 때문이다.

---

# 38. 기존 Gemini pipeline 연결

현재 Gemini Framing에서 사용하는
chunk extraction logic은 최대한 유지한다.

다만 입력 chunk 생성 source를:

```text
old structuralChunks()
```

에서:

```text
Markdown-aware Context Builder
```

로 교체할 수 있는 구조를 만든다.

이번 작업에서 Gemini semantic prompt 자체를 크게 수정하지 않는다.

---

# 39. Context Unit에 Structure Metadata 포함

각 AI Context Unit에는 최소한:

```text
contextUnitId
sectionId
headingPath
source line range
byte length
```

를 내부적으로 보존한다.

Attempt Journal에도 가능하면:

```text
contextUnitId
sectionId
```

를 추적 가능하게 한다.

---

# 40. Heading 없는 긴 문서 fallback

Heading이 없는 긴 문서에서는:

```text
Root Section
↓
Paragraph/List/etc Blocks
↓
Block groups
```

방식으로 Context를 만든다.

문단 경계를 우선한다.

다음처럼 하지 않는다.

```text
16 KiB
16 KiB
16 KiB
```

blind byte slicing.

---

# 41. 작은 Section 병합

너무 짧은 Section이 여러 개 연속될 경우
각각 별도 AI request를 보내지 않아도 된다.

조건:

```text
전체 budget 내
원문 순서 유지
상위 문맥이 호환됨
```

이면 인접 Section을 한 Context Unit에 묶을 수 있다.

예:

```text
H2 A — 200 bytes
H2 B — 300 bytes
H2 C — 400 bytes
```

를 하나의 Context Unit으로 묶는 것이 가능하다.

단 서로 다른 최상위 주제가 섞이지 않도록
parent hierarchy를 고려한다.

---

# 42. 큰 Section 분해와 작은 Section 병합을 모두 지원

Context Builder의 목표는:

```text
너무 큰 의미 단위는 안전하게 분할
너무 작은 의미 단위는 자연스럽게 병합
```

이다.

단순 one-section-one-request 규칙으로 고정하지 않는다.

---

# 43. Context Unit Quality 목표

좋은 Context Unit은:

```text
한 가지 또는 밀접한 주제 흐름을 포함
Markdown 구조가 유지됨
본문이 중간에서 끊기지 않음
상위 제목 문맥을 알 수 있음
budget을 넘지 않음
```

이어야 한다.

---

# 44. Context Unit은 의미 분류를 하지 않는다

Phase 1 Context Builder에서:

```text
이 Section은 CAPM
이 Section은 의견
이 Section은 중요한 내용
```

같은 semantic inference를 하지 않는다.

Markdown structure만 사용한다.

---

# 45. Local Inspection UI

Phase 1 Frame inspection에서 최소한 다음을 볼 수 있게 한다.

```text
Document

Sections
- heading path
- line range
- byte length

Structural Stats

Grounding Signals

Semantic
- 아직 실행되지 않음
```

개발자 확인을 위해
Section Tree를 읽기 쉽게 표시하면 좋다.

---

# 46. Optional Developer Preview

필요하면 Developer Details에서:

```text
예상 AI Context Units
```

를 preview할 수 있다.

예:

```text
Context 1
투자 이론 → 효율적 시장 가설
Lines 1–74
8.2 KiB

Context 2
투자 이론 → 행동재무학
Lines 75–122
5.4 KiB
```

이 기능이 구현 부담이 크다면 이번 scope에서 제외할 수 있다.

Change Candidate로 남겨도 된다.

---

# 47. Phase 1 Source Identity

Structural Frame은 원문 version과 연결되어야 한다.

가능하면 기존 source hash 방식을 재사용한다.

예:

```text
sourceHash
hashEncoding
```

Phase 1 Frame이 현재 Markdown version과 일치하는지 검증 가능해야 한다.

---

# 48. 기존 Source Preservation 원칙 유지

Phase 1 Framing은 절대로:

```text
원문 수정
자동 heading 삽입
paragraph 재작성
formatting 변경
```

을 하지 않는다.

Markdown은 read-only source다.

---

# 49. Frame Schema Version

기존 local schemaVersion 1과 구분한다.

새 Structural Frame은 새 schema version을 사용한다.

정확한 번호는 repository 전체 version history를 확인해서 정한다.

---

# 50. Storage Migration

기존:

```text
local-test-v1
```

Frame에는 meaningful human annotation이 없다.

따라서 복잡한 automatic migration을 만들지 않는다.

새 local framing을 실행하면:

```text
local-structural-v1
```

결과로 교체할 수 있다.

---

# 51. 테스트 — Heading Hierarchy

입력:

```markdown
# A

## B

### C

## D
```

기대:

```text
A
├─ B
│  └─ C
└─ D
```

각 Section의 headingPath가 정확해야 한다.

---

# 52. 테스트 — Code Fence 보호

입력:

````markdown
# Real Heading

```markdown
# Fake Heading
- fake list
```
````

`Fake Heading`은 Section으로 생성되지 않는다.

---

# 53. 테스트 — List Atomicity

긴 list가 budget 안에 있으면
한 Context Unit 안에서 유지되어야 한다.

List item 중간에서 분리하지 않는다.

---

# 54. 테스트 — Table Atomicity

budget 안의 table은
row 중간에서 분리하지 않는다.

---

# 55. 테스트 — Section 유지

Section 전체가 budget 안이면:

```text
one Section
→ one complete context
```

가 가능해야 한다.

문단 단위로 불필요하게 분해하지 않는다.

---

# 56. 테스트 — Child Section Split

부모 Section이 너무 크고
여러 child Section이 있을 경우:

```text
child Sections
```

기준으로 분할해야 한다.

---

# 57. 테스트 — Heading Context

Child Section이 독립 Context가 되더라도:

```text
headingPath
```

에 모든 필요한 parent heading이 포함된다.

---

# 58. 테스트 — Heading 없는 긴 문서

Heading이 없더라도:

```text
paragraph boundary
list boundary
```

를 존중하며 여러 Context Unit을 만든다.

blind byte split을 하지 않는다.

---

# 59. 테스트 — Oversized Paragraph

단일 paragraph가 budget을 넘는 경우:

```text
sentence/line fallback
```

으로 deterministic하게 나뉜다.

Unicode 문자열을 손상시키지 않는다.

---

# 60. 테스트 — 원문 순서

Structural blocks와 Context Units 모두
원문 순서를 유지한다.

---

# 61. 테스트 — Source Coverage

정상 prose/document content는 Context 생성 시:

```text
누락 없이
중복 없이
```

Source range로 추적 가능해야 한다.

단 context heading wrapper는 source text coverage 계산에서 제외한다.

---

# 62. 테스트 — No Semantic Fields

Local Structural Frame에는 다음 semantic result가 없어야 한다.

```text
domains
contentNature
concepts
knowledgeUnits
AI confidence
```

다음만 존재:

```json
{
  "semantic": {
    "status": "not-run"
  }
}
```

---

# 63. 테스트 — Grounding Signals

Markdown의:

```text
external link
footnote
blockquote
reference heading
source frontmatter
```

를 deterministic하게 검출한다.

이 값으로 Content Nature를 자동 결정하지 않는다.

---

# 64. Regression

반드시 다음 기존 기능을 깨뜨리지 않는다.

```text
Manual wait queue
Local frame persistence
file rename/delete invalidation
unsaved editor content handling

Gemini API
Domain Catalog
Domain reuse
Domain approval

Concept extraction
Korean concept preservation
Concept consolidation

Content Nature
Attempt Journal
503 retry
timeout handling
SecretStorage
```

---

# 65. 이번 작업에서 하지 않을 것

이번 작업 범위에서는 다음을 구현하지 않는다.

```text
Content Nature 정확도 개선
Grounding-aware AI classification
Human Review
Ambiguity policy

Hierarchical Concept consolidation
candidate budget 개선

Embedding
Vector DB
RAG
Knowledge Graph
Fact checking

Semantic chunking with AI
```

이 작업의 범위는:

> Markdown-Aware Phase 1 Structural Framing + Phase 2 Context Builder 기반

까지만이다.

---

# 66. 권장 구현 순서

```text
1. 기존 TestEngine / extractBlocks / structuralChunks 검토

2. Markdown structural model 정의

3. parseMarkdownStructure 구현

4. Section Tree 생성

5. Structural Blocks 생성

6. Structural Stats / Grounding Signals

7. local-structural-v1 Frame

8. Context Builder 구현

9. Section-first packing

10. child-section fallback

11. block-level fallback

12. oversized paragraph fallback

13. Gemini pipeline에 Context Unit 연결

14. UI 수정

15. Tests

16. Docs reconciliation

17. Build / verification
```

---

# 67. 완료 기준

이번 작업은 다음 조건을 만족해야 완료다.

```text
기존 TEST_ONLY Knowledge Unit이 제거된다.

local-test-v1이 local-structural-v1으로 교체된다.

Markdown Heading hierarchy가 Section Tree로 변환된다.

Paragraph / List / Quote / Code / Table 등이
구조적으로 구분된다.

긴 문서를 blind byte slicing하지 않는다.

Section 전체가 budget 안이면 흐름을 유지한다.

큰 Section은 child Section을 우선하여 분해한다.

AI Context Unit에 parent Heading context가 보존된다.

Heading 없는 문서도 paragraph/block boundary를 이용한다.

Local Frame은 semantic inference를 하지 않는다.

Phase 2 Gemini가 새 Context Builder의 결과를 사용할 수 있다.

기존 semantic framing 기능에 regression이 없다.
```

---

# 68. 완료 보고 형식

완료 후 다음 순서로 보고한다.

1. 기존 local framing / structuralChunks 문제점
2. 새 Phase 1 제품 정의
3. Structural Frame schema
4. Markdown parser 구조
5. Section Tree 규칙
6. Structural Block 종류와 규칙
7. Grounding Signals
8. Context Builder architecture
9. Section-first packing 전략
10. oversized content fallback 전략
11. parent Heading context 보존 방법
12. Gemini pipeline 연결 변경
13. storage/schema 변경
14. UI 변경
15. 수정 source files
16. 추가 tests
17. verification commands
18. build/test 결과
19. 실제 긴 Markdown 테스트 결과
20. Open Decisions
21. 구현하지 않은 Change Candidates

임의로 기능 범위를 확장하지 않는다.
