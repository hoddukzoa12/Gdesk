# 규칙

## 검증 관문

변경을 합치기 전에 아래가 모두 종료 코드 0이어야 한다. CI도 같은 명령을 돌린다.

| 명령                           | 검사                                                                                                                      | CI에서                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `pnpm typecheck`               | 메인·프리로드·공용·테스트(`tsconfig.node.json`)와 화면·공용(`tsconfig.web.json`) 둘 다 strict, `noUncheckedIndexedAccess` | 맥·윈도우·리눅스         |
| `pnpm lint`                    | ESLint, 경고 0개(`--max-warnings 0`)                                                                                      | 맥·윈도우·리눅스         |
| `pnpm exec prettier --check .` | 작은따옴표, 세미콜론 없음, 한 줄 100자                                                                                    | 리눅스만(CRLF 차이 회피) |
| `pnpm test`                    | Vitest 단위 테스트                                                                                                        | 맥·윈도우·리눅스         |
| `pnpm test:e2e`                | 테스트 빌드 + Playwright Electron 화면 테스트(가짜 GitHub)                                                                | 맥·리눅스(리눅스는 xvfb) |

- 화면을 바꾸는 변경은 `pnpm test:e2e`까지 통과해야 한다.
- 화면 테스트는 실제 GitHub에 접속하지 않는다. 새 시나리오가 GitHub 요청을 하면 가짜 서버에 그 응답을 더한다.

## 의존성과 실행 환경

- 패키지 관리자는 pnpm(`packageManager: pnpm@9.12.0`)이다. CI는 `pnpm install --frozen-lockfile`이라 `pnpm-lock.yaml`을 함께 고치지 않은 의존성 변경은 CI 설치에서 실패한다.
- Node는 22.13 이상(`engines`)이다. 단위 테스트가 `node:sqlite`를 Node에서 직접 쓰기 때문이다. CI는 Node 22를 쓴다.
- 네이티브 모듈을 넣지 않는다. 패키징이 `npmRebuild: false`이고 SQLite는 `node:sqlite`다. 설치 스크립트를 돌려야 하는 패키지는 `pnpm.onlyBuiltDependencies`(`dugite`, `electron`, `esbuild`)에 넣어야 설치된다.
- `electron`은 정확한 버전(`44.7.2`)으로 고정한다. 앱의 SQLite는 이 Electron에 든 Node의 `node:sqlite`이므로, Electron을 올리면 단위 테스트(Node 22)와 실제 앱(Electron 속 Node) 양쪽에서 DB 동작을 확인한다.

## 모듈 경계

| 모듈           | 가져올 수 있는 것                                     | 가져오면 안 되는 것                                                                                                                             |
| -------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer` | `@shared/*`, `@renderer/*`, 브라우저 패키지           | `electron`, `fs`, `path`, `child_process`, `os`, `crypto`, `node:*`, `src/main`(ESLint `no-restricted-imports`로 실패)                          |
| `src/shared`   | 다른 `src/shared` 파일                                | `src/main`, `src/renderer`, `src/preload`, Node·Electron·DOM API(양쪽 tsconfig에 모두 포함되므로 한쪽 전용 API를 쓰면 다른 쪽 typecheck가 실패) |
| `src/preload`  | `electron`의 `contextBridge`·`ipcRenderer`, 공용 타입 | 기능 코드                                                                                                                                       |
| `src/main`     | `@shared/*`, Node, Electron                           | `src/renderer`                                                                                                                                  |

- 화면과 메인은 `src/shared/ipc`의 계약으로만 통신한다. 화면은 `src/renderer/lib/ipc.ts`의 `invoke`·`useIpcQuery`·`useIpcEvent`만 쓴다.
- GitHub 호출은 `src/main/github/client`의 요청 계층만 한다. 다른 곳에서 `fetch`로 GitHub API를 부르지 않는다. 예외는 저장 전 후보 토큰을 확인하는 `GET /user`와 기기 인증 두 요청뿐이다.
- 연결 상태(`online`/`offline`/`rate_limited`/`session_expired`)는 요청 계층만 정한다. 동기화·쓰기·검색·로컬 서비스는 `getStatus`·`onStatusChange`로 읽기만 한다.
- git 실행은 `src/main/git/runner.ts`의 `runGit`을 거친다. 시스템 git을 부르지 않는다.
- 캐시 테이블 쓰기는 `src/main/cache`의 함수로 한다. 화면용 조회(`query:*`)는 캐시만 읽고 GitHub에 요청하지 않는다.
- Electron을 import하는 파일과 로직 파일을 나눈다. 서비스(`*.service.ts`, `engine.ts`, `token-store.ts` 등)는 Electron 없이 Node만으로 단위 테스트되도록 바깥 의존을 주입받는다. Electron 연결은 `index.ts`·`electron.ts`·`*.ipc.ts`에 둔다.

## 등록 규칙(자동 수집)

공유 등록 파일을 고치지 않고 기능 폴더 안 파일만으로 등록한다. 아래 이름·모양을 어기면 등록되지 않거나 시작할 때 실패한다.

| 무엇            | 파일                                               | 내보내는 것                                                                                   | 모으는 곳                                                         |
| --------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| IPC 채널 계약   | `src/shared/ipc/<기능>.ts`                         | `declare module './contract'`로 `IpcInvokeChannels`·`IpcEventChannels` 확장, 끝에 `export {}` | 타입 선언 병합                                                    |
| IPC 처리기      | `src/main/<기능>/<이름>.ipc.ts`                    | `export function registerIpc()`                                                               | `src/main/ipc/registry.ts`의 `import.meta.glob('../**/*.ipc.ts')` |
| DB 마이그레이션 | `src/main/<기능>/<이름>.migration.ts`              | `export const migration` 또는 `migrations`                                                    | `src/main/db/migrations.ts`의 glob. 둘 다 없으면 시작 때 오류     |
| 화면 라우트     | `src/renderer/features/<기능>/route.tsx`           | `export const routes: RouteObject[]`(경로는 `/` 없이)                                         | `src/renderer/app/router.tsx`                                     |
| 화면 슬롯       | `src/renderer/features/<기능>/slots.tsx`           | `export const slots: FeatureSlots`                                                            | `src/renderer/app/slots.ts`                                       |
| 번역            | `src/renderer/locales/{en,ko}/<네임스페이스>.json` | JSON 객체                                                                                     | `src/renderer/app/i18n.ts`                                        |

- 채널 이름은 `<기능>:<동작>`이다. 화면 조회는 반드시 `query:`로 시작한다. 화면은 `data:changed`를 받으면 `query:`로 시작하는 조회만 다시 읽는다.
- `*.ipc.ts`는 처리기 안에서 DB·서비스를 호출 시점에 가져온다(`getDb()` 등). 등록이 서비스 초기화보다 먼저 일어날 수 있기 때문이다. 등록 시점에 `getGitHubClient()`를 부르는 처리기는 `src/main/index.ts`에서 요청 계층을 만든 뒤에 등록되어야 한다.
- `slots.tsx`·`route.tsx`는 앱 시작 때 바로 읽힌다. 모듈 최상위에서 `window.gdesk`를 부르지 않는다.
- 공유 파일(`src/shared/ipc/contract.ts`, `src/main/ipc/registry.ts`, `src/preload/index.ts`, 앱 틀)은 기능 변경에서 고치지 않는다. 서비스 초기화가 필요하면 `src/main/index.ts`의 시작 순서에 맞춰 한 곳에 더한다.

## DB 마이그레이션

- 마이그레이션 ID는 전역에서 유일한 문자열이고 문자열 순서로 적용된다. 핵심 테이블은 `0001_core`, 캐시는 `0100_cache`·`0101_cache_list_meta`·`0102_home_activity`·`0103_issue_detail`·`0104_issue_actions`다. 새 마이그레이션은 기존 것보다 큰 접두사를 쓴다. 중복 ID는 시작 때 오류다.
- 이미 배포된 마이그레이션은 고치지 않는다. 바꿀 것이 있으면 새 ID로 더한다. 적용 여부는 `schema_migrations`의 ID로만 판단하므로 고친 내용은 이미 설치된 앱에 반영되지 않는다.
- 받아온 정보를 담는 테이블은 이름을 `cache_`로 시작하고 `src/main/cache/cleaner.ts`의 `CACHE_TABLES`에 더한다. 빠지면 로그아웃·계정 전환 때 지워지지 않는다(단위 테스트가 빠진 테이블을 잡는다).
- 계정과 무관한 데이터(설정)는 `cache_` 테이블에 넣지 않는다. 계정에 묶이지만 받아온 정보가 아닌 데이터(고정·로컬 연결 같은 것)를 새로 만들면 `src/main/db/cleanup.ts`의 `clearAccountData`에 지우기를 더한다.
- 여러 행을 바꾸는 쓰기는 `withTransaction`으로 감싼다. 이미 트랜잭션 안이면 SAVEPOINT로 중첩된다.

## 문구와 번역

- 사용자에게 보이는 문구는 코드에 쓰지 않고 번역 파일에 둔다.
- 새 네임스페이스는 `en`과 `ko` 파일을 함께 만든다. 두 언어의 파일 목록과 키 집합이 같아야 한다(`tests/unit/locales.test.ts`가 실패한다).
- 메인이 화면으로 보내는 실패는 문구가 아니라 코드(`CloneFailureCode`, `LinkFailureReason`, `OpenFailureReason`, `AuthErrorCode`, `ActionBlockReason` 등)로 보낸다. 화면이 번역한다. 원문(git 오류 등)은 `detail`로만 덧붙인다.

## 입출력 계약 패턴

- 화면에서 온 요청 값은 메인 처리기에서 다시 검사한다. 타입 선언은 실행 중에 강제되지 않는다.
- 예상 가능한 실패는 던지지 않고 결과 값으로 돌려준다(`{ ok: false, reason }`, `{ kind: 'failed', code }`). 던지는 것은 잘못된 요청(검사 실패)뿐이다.
- 화면으로 가는 값에는 토큰과 오류 객체 원문을 담지 않는다.
- 네트워크 응답을 캐시에 쓰는 메인 코드는 계정 데이터 세대(`currentDataGuard()`)를 요청 시작 때 잡고 쓰기 직전에 확인한다. 확인 없이 쓰면 로그아웃·계정 전환 뒤에 이전 계정 데이터가 다시 들어온다.
- 캐시를 바꾸는 메인 코드는 바꾼 뒤 `notifyDataChanged`로 영향받는 키(`home`, `inbox`, `pulls`, `reviews`, `issues`, `starred`, `repositories`, `sidebar`, `repo:<ID>`, `issue:<저장소 ID>#<번호>`)를 알린다.
- GraphQL mutation도 조회와 같이 고유한 `Gdesk*` operationName을 갖고 `OPERATIONS`에 등록한다. 가짜 서버는 `tests/fixtures/github/graphql.ts`의 `MUTATIONS`에 처리기가 있는 이름만 쓰기로 센다(`failNextWrites`의 대상). 새 mutation을 조회 처리기 쪽에 넣으면 쓰기 실패 화면 테스트를 만들 수 없다. 응답만 받는 POST(`POST /markdown` 같은)는 `tests/fixtures/github/server.ts`의 `READ_ONLY_POSTS`에 더해 쓰기로 세지 않게 한다.
- GraphQL 문서는 고유한 `Gdesk*` operationName을 갖고 `src/main/github/collectors/queries.ts`의 `OPERATIONS`에 등록한다. 가짜 GitHub 서버가 이 이름으로 응답을 고르므로, 이름이 없거나 등록되지 않으면 화면 테스트에서 응답을 받지 못한다.

## GitHub HTML 표시

- GitHub가 만든 HTML(이슈 본문·코멘트의 `bodyHTML`, `POST /markdown` 결과)은 `src/renderer/features/issues/sanitize.ts`의 `sanitizeIssueHtml`을 거친 뒤에만 DOM에 넣는다. 화면 부품은 `SafeHtml`을 쓴다. 정리하지 않은 문자열을 `innerHTML`·`dangerouslySetInnerHTML`에 넣지 않는다.
- DOMPurify 훅은 `sanitize.ts`가 만든 전용 인스턴스에만 단다. 공용 기본 인스턴스(`DOMPurify.sanitize`, `DOMPurify.addHook`)에 훅을 달지 않는다. 기본 인스턴스의 훅은 그것을 쓰는 모든 코드에 퍼진다(`sanitize.test.ts`가 기본 인스턴스가 영향받지 않는지 본다).
- 본문 안 링크 클릭은 앱 창 이동을 막고 http(s)만 `app:openExternal`로 넘긴다. 새 화면이 GitHub HTML을 보여도 같은 부품을 쓴다.

## 빌드 상수와 환경 설정

- 빌드 때 넣는 값은 `electron.vite.config.mts`의 `__GDESK_*__` 상수로 정의하고, `src/env.d.ts`에 타입을, `vitest.config.mts`의 `define`에 단위 테스트 값을 함께 넣는다. 셋 중 하나라도 빠지면 typecheck 또는 단위 테스트가 실패한다.
- 메인 코드는 빌드 상수를 `src/main/config.ts`를 거쳐 읽는다.
- 테스트용 덮어쓰기는 `isTestMode()`(테스트 빌드 상수 && `GDESK_TEST_MODE=1`)로 감싼다. 환경 변수만으로 켜지는 덮어쓰기를 만들지 않는다.
- 비밀 값(client secret, 서명 비밀값)은 빌드 상수·코드·저장소에 넣지 않는다.

## 테스트

- 단위 테스트 파일은 `src/**/*.test.{ts,tsx}`와 `tests/unit/**`에 둔다. 기본 환경은 node이고, 화면 컴포넌트 테스트는 파일 첫 줄에 `// @vitest-environment jsdom`을 둔다.
- 화면 테스트 파일은 `tests/e2e/*.e2e.ts`이고 `tests/e2e/support/fixtures.ts`의 `test`를 쓴다. Playwright 기본 `test`로 앱을 띄우면 테스트 모드 환경·임시 홈·가짜 서버가 붙지 않는다.
- 다음 규칙을 바꾸면 해당 단위 테스트가 함께 있어야 한다: CI 상태 판정, 응답 없는 새 기여, 실패한 CI 카드, 스타 증가 창, 원격 주소 해석과 저장소 매칭, 세션 규칙(로그아웃·계정 전환 삭제 범위), 오류 보고 지우기, 요청 한도 보호, HTTPS 클론 뒤 토큰 미잔존, 클론 실패 시 정리 범위, Home 영역 목록 풀기, 연속 기여·Home 수치, PR 표시 상태, 이슈 코멘트 가능 판정, 이슈 쓰기 막힘·거절·되돌림, 만든 이슈의 유예, GitHub HTML 정리.

## 커밋

- Conventional Commits 형식에 한국어 설명: `<종류>(<범위>): <무엇을 했는지>`. 종류는 `feat`·`fix`·`test`·`docs`·`refactor`·`chore`·`ci`, 범위는 기능 폴더 이름.
- 한 커밋에는 한 가지 변경만 담는다.
- 릴리스 태그는 `v<package.json version>`과 정확히 같아야 한다. 다르면 릴리스 워크플로가 실패한다.
