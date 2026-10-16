# src/renderer — 화면

## 맡는 것

React 화면 전체: 앱 틀(사이드바, 상단 막대, 본문), 기능별 화면(`features/*`), 공용 부품(`components/`), 테마(`theme/`), 번역(`locales/`), 메인 호출 도우미(`lib/ipc.ts`), 여러 기능이 함께 쓰는 훅(`lib/hooks/`).

## 맡지 않는 것

- GitHub 호출, 토큰, git, DB, 파일 시스템, 외부 프로그램 실행. 화면은 격리되어 있다(`contextIsolation`, `sandbox`, Node 없음). 빌드된 화면의 CSP는 `index.html`의 `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com https://*.githubusercontent.com https://github.githubassets.com https://github.com; font-src 'self' data:; connect-src 'self'`다. 이미지는 앱 자체(`'self'`), `data:`, GitHub 이미지 호스트(아바타, 이슈 본문 이미지용 `*.githubusercontent.com`·`github.githubassets.com`·`github.com`)만 표시한다. `connect-src`는 `'self'` 그대로다. 개발 서버에서만 `connect-src`에 `ws://localhost:*`가 더해진다(`electron.vite.config.mts`).
- 업무 계산(CI 판정, 응답 없는 새 기여, 스타 증가, 들어온 항목 수). 메인이 계산한 값을 그대로 보여 준다.
- 메인·프리로드 코드 import. `electron`, `fs`, `path`, `child_process`, `os`, `crypto`, `node:*`, `**/main/**`는 ESLint가 막는다.
- 앱 틀 파일(`app/router.tsx`, `app/routes.tsx`, `app/slots.ts`, `app/i18n.ts`, `app/AppLayout.tsx`, `app/Sidebar.tsx`)은 기능 변경에서 고치지 않는다. 기능은 자기 폴더 파일로 끼운다.

## 반드시 지킬 것

- 메인과의 통신은 `lib/ipc.ts`의 `invoke`, `useIpcQuery`, `useIpcEvent`로만 한다. `window.gdesk`를 직접 부르는 곳은 `lib/ipc.ts`뿐이다.
- 화면 코드는 토큰을 보관하지 않는다. 로그인 입력란의 토큰은 React 상태에 두지 않고, `auth:loginWithToken`으로 보내기 전에 입력란을 비운다. 세션 정보는 `SessionSnapshot`(사용자, 토큰 종류, 빠진 권한)만 쓴다.
- 사용자에게 보이는 문구는 모두 `locales/en/<ns>.json`과 `locales/ko/<ns>.json`에 함께 둔다. 코드에 문장을 쓰지 않는다. 메인이 준 `reason`·`code`는 번역 키로 바꾸고, 모르는 값은 기본 문구로 떨어뜨린다(`clone-logic.ts`의 `cloneFailureKey` 등).
- 쓰기 버튼(스타, 읽음, 완료, 클론)은 `actions:getAvailability`/`actions:availability`가 `available: false`면 끈다. 쓰기 결과는 메인이 캐시를 바꾸고 `data:changed`로 알리므로, 화면은 결과를 직접 캐시에 써 넣지 않고 다시 읽은 값을 보여 준다. 실패(`reason: 'failed'`)면 오류를 알린다.
- 외부 링크는 `app:openExternal`로 연다. `<a target="_blank">`나 `window.open`은 메인이 막는다.
- 색은 테마 변수(`theme/theme.css`)로만 쓴다. CI 상태 색: `passing` 초록, `failing` 빨강, `pending` 노랑, `none` 회색.
- 화면 자동 테스트가 찾는 `data-testid`를 바꾸면 `tests/e2e`도 함께 바꾼다.

## 구현 방식

### 기능 폴더

`features/<기능>/`에 둔다. 앱 틀은 다음을 자동으로 모은다.

| 파일        | 내보내는 것                          | 용도                                                                                                                                                  |
| ----------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `route.tsx` | `export const routes: RouteObject[]` | 해시 라우터의 자식 경로. `path`는 `/` 없이(`'inbox'`, `'repos/:repoId'`)                                                                              |
| `slots.tsx` | `export const slots: FeatureSlots`   | `sidebarTop`, `sidebarSections`(order), `sidebarFooter`, `banners`(order), `overlays`, `headerActions`(order), `useNavCounts`, `usePreferencesSource` |

- `slots.tsx`·`route.tsx`는 앱 시작 때 eager로 읽힌다. 모듈 최상위에서 `window.gdesk`를 부르거나 무거운 일을 하지 않는다.
- 다른 기능의 화면을 열 때는 그 기능이 내보낸 함수를 쓴다(예: 클론 대화상자는 `features/clone/store.ts`의 `requestClone`).
- 지금 쓰는 배너 순서: 세션 만료 10, 오프라인 20, 토큰 경고 40, 조직 제한 45, 업데이트 100. 사이드바 섹션: Pinned 10, Your repositories 20.

### 데이터 읽기

- `useIpcQuery(channel, req)`는 react-query 키 `[channel, req]`로 읽는다. 설정은 `staleTime: Infinity`, 포커스 때 다시 읽지 않음, 재시도 없음이다.
- `data:changed`가 오면 `query:`로 시작하는 쿼리만 모두 무효화된다(`main.tsx`에서 한 번 설치).
- `query:`가 아닌 채널은 스스로 따라가야 한다. 그렇지 않으면 화면이 영원히 옛 값을 보인다.
- 설정·동기화 상태·세션·쓰기 가능 여부는 `lib/hooks/`의 `useSettings`(저장은 `useUpdateSettings`), `useSyncStatus`, `useSession`, `useActionAvailability`로 읽는다. 아래 이벤트를 이미 따라가므로 기능 폴더에 같은 훅을 다시 만들지 않는다. 실행 OS는 `app/platform.ts`의 `usePlatform`을 쓴다.

| 채널                      | 따라갈 이벤트                                   |
| ------------------------- | ----------------------------------------------- |
| `local:listLinks`         | `data:changed`에서 `['local:listLinks']` 무효화 |
| `pins:list`               | `pins:changed`                                  |
| `settings:get`            | `settings:changed`                              |
| `sync:getStatus`          | `sync:status`                                   |
| `actions:getAvailability` | `actions:availability`                          |
| `auth:getSession`         | `auth:changed`                                  |
| `updater:getStatus`       | `updater:status`                                |

- 저장소 상세는 `query:repoDetail`이 `null`이면(캐시에 없음) 상세 수집을 기다리는 상태로 보여 준다. 메인이 받은 뒤 `data:changed`로 다시 읽힌다.

### 상세 추적 알리기

저장소 상세 화면은 마운트 때 `sync:setViewedRepo { repoId }`, 언마운트 때 `{ repoId: null }`을 보낸다. 이것을 빼면 상세가 고정 저장소만 받아져 남의 저장소 화면이 머리글만 보인다.

### 새로고침 단축키

⌘R(맥) / Ctrl+R(그 외)은 `features/sidebar/SyncFooter.tsx`가 `keydown`으로 잡아 `sync:refresh`에 지금 주소의 범위(`refreshScope.ts`)를 보낸다. 앱 메뉴에는 화면 다시 불러오기가 없다. 다른 곳에서 이 단축키를 쓰지 않는다.

### 언어·테마

- 기본 언어는 `navigator.language`가 `ko`로 시작하면 한국어, 그 밖은 영어. 설정 값(`system`·`en`·`ko`)은 설정 기능의 `usePreferencesSource`가 공급한다.
- 테마 `system`은 `prefers-color-scheme`를 따르고 바뀌면 바로 반영한다.

### 오류 수집

오류 보고 오버레이(`features/crash`)가 마운트될 때 `window`의 `error`·`unhandledrejection`을 메인에 보낸다(`crash:reportRenderer`). 같은 오류 묶기·횟수 제한·지우기는 메인이 한다. 화면은 받은 보고서(`crash:show`, `crash:pending`)를 그대로 보여 주고, 보내기는 ID로 `crash:openIssue`/`crash:copy`를 부른다.

## 테스트

- 순수 로직(`*-logic.ts`, `footerText.ts`, `refreshScope.ts`, `reorder.ts` 등)은 `*.test.ts`로 node 환경에서 테스트한다.
- 컴포넌트 테스트는 파일 첫 줄에 `// @vitest-environment jsdom`을 두고 `@testing-library/react`로 그린다. `window.gdesk`는 가짜로 넣는다.
- 번역 키 집합은 `pnpm test`가 en·ko를 비교한다. 새 키를 한쪽에만 넣으면 실패한다.
- 화면 흐름(클릭 → 메인 → 다시 읽기)은 `tests/e2e`의 화면 테스트로 확인한다. 쓰기 실패 되돌림, 오프라인 비활성화, `query:`가 아닌 채널의 갱신은 단위 테스트로 잡히지 않는다.
- 꼭 확인할 엣지: 데이터가 없을 때와 로딩 중 상태, 오프라인·세션 만료일 때 쓰기 버튼 비활성화, 세분화 토큰이면 Inbox 대신 안내, `unavailable` 저장소의 고정 항목에 제거 버튼, 목록이 불완전할 때 "GitHub에서 더 보기".
