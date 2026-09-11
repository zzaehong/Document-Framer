# Document Framer

Obsidian Markdown 원문을 보존하고 별도 Frame을 만드는 플러그인입니다. 현재는 [MVP 계획](Doc/MVP_plan.md)의 **1단계: 수동 처리의 기본 흐름**을 구현했습니다.

## 바로 테스트하기

Node.js 22 이상에서:

```bash
npm ci
npm test
npm run test:vault
```

1. Obsidian의 **보관함 관리 → 폴더를 보관함으로 열기**에서 이 프로젝트의 `.test-vault` 폴더를 선택합니다. 숨김 폴더가 보이지 않으면 전체 경로를 입력합니다.
2. 설정 → 커뮤니티 플러그인에서 제한 모드를 해제하고 **Document Framer**를 활성화합니다.
3. `시작하기.md`를 열고 왼쪽 리본의 **현재 문서 Framing** 아이콘 또는 명령 팔레트의 **Document Framer: 현재 문서 Framing 요청**을 실행합니다.
4. 오른쪽 패널에서 대기 상태와 저장된 JSON 결과를 확인합니다. 패널의 **현재 문서 Framing** 버튼으로도 요청할 수 있습니다.

마지막 원문 변경 후 60초가 지나야 실행됩니다. 이미 60초 이상 지난 문서는 바로 실행됩니다. 새로 한 글자를 입력하고 버튼을 누르면 대기 흐름을 볼 수 있습니다. 대기 중 편집하면 다시 60초를 계산하고, 같은 내용의 저장은 대기를 늘리지 않습니다. 문서 열기나 저장만으로는 실행되지 않습니다. API 키와 네트워크 연결은 필요 없습니다.

`npm run test:vault`를 다시 실행하면 플러그인 빌드를 갱신하며 기존 테스트 문서와 Frame은 보존합니다. Obsidian에서 플러그인을 껐다 켜면 새 빌드가 적용됩니다.

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
- 테스트 엔진: 문서 전체를 하나의 테스트 Unit으로 표현. `engine: local-test-v1`, `TEST_ONLY` 라벨. 실제 Domain/Type/Confidence는 빈 배열 또는 null로 표시.
- 저장 위치: `<Vault 설정 폴더>/plugins/document-framer/data.json`. 원문을 수정하지 않으며 재시작 후 **Frame 보기** 명령으로 다시 조회 가능.
- 빈 문서와 2 MiB 초과 입력은 오류 표시. 저장 실패 시 기존 메모리 결과를 유지하고 수동 재시도 가능.

실제 AI 분류·의미 단위 분할은 2단계, 안전한 원문 버전 비교와 저장 복구는 3단계, 자동 실행·60→240초 가변 대기는 4단계입니다. 중요도/Highlight 수정, 질문, 파일 이동 시 Frame 연결 복구와 미완료 요청 복구도 후속 단계입니다. 현재 Frame 키는 파일 경로이며 대기 요청은 재시작하면 사라집니다. 표시 결과는 저장 당시 결과로, 원문 수정 후에는 다시 요청해야 합니다. metadata의 수정 시각은 파일 저장 시각이며 아직 저장되지 않은 편집 시각과 다를 수 있습니다.

## 검증

`npm test`는 가상 시계로 60초 경계·대기 초기화·중복 요청·문서별 격리와 입력 검증을 확인합니다. Obsidian API 모형을 통해 실제 플러그인 진입점의 요청→저장→재로드 및 저장 실패를 검증합니다. `npm run build`는 TypeScript 검사와 Obsidian용 CommonJS 번들을 생성합니다. 실제 Obsidian 화면 동작은 위 테스트 Vault에서 아래 순서로 확인합니다.

1. 편집 직후 요청 → 카운트다운 → 저장 완료.
2. 대기 중 편집 → 남은 시간이 다시 60초.
3. 원문을 비교해 자동 수정이 없음을 확인.
4. 플러그인을 껐다 켜고 **Frame 보기** → 기존 결과 확인.
5. 두 번째 문서 열기만으로 처리되지 않음 → 수동 요청하면 해당 문서 결과 생성.
6. 공백만 있는 문서 요청 → 내용 없음 메시지, Frame 생성 안 됨.
