# tests — 가짜 GitHub와 화면 자동 테스트

## 맡는 것

| 폴더               | 내용                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `fixtures/github/` | 가짜 GitHub 서버(`startFakeGitHub`)와 고정 데이터(`FIXTURE`, `buildFixtures`). 화면 테스트와 단위 테스트가 함께 쓴다. |
| `e2e/`             | Playwright Electron 화면 테스트(`*.e2e.ts`)와 공용 준비 코드(`support/fixtures.ts`, `support/helpers.ts`)             |
| `unit/`            | 가짜 서버 자체 검사(`fake-github*.test.ts`), 번역 en·ko 키 집합 검사(`locales.test.ts`)                               |

## 맡지 않는 것

- 앱 코드. 메인·화면 기능의 단위 테스트는 각 소스 파일 옆(`src/**/*.test.ts`)에 둔다.
- 실제 GitHub. 어떤 테스트도 github.com·api.github.com에 접속하지 않는다.
- 테스트를 위한 앱 쪽 통로(테스트 모드, 실행 기록, 일부러 오류 내기)는 `src/main`에 있고 `isTestMode()`로 감싸져 있다. 테스트가 새 통로를 요구하면 앱 쪽에서 같은 방식으로 감싼다.

## 반드시 지킬 것

- 화면 테스트는 `./support/fixtures`의 `test`·`expect`를 쓴다. Playwright 기본 `test`로 앱을 띄우면 테스트 모드 환경, 임시 홈, 가짜 서버, 브라우저 열기 가로채기가 붙지 않아 개발자의 실제 홈 폴더를 훑고 실제 브라우저를 연다.
- 준비 코드(`support/fixtures.ts`)가 앱을 띄울 때 넣는 환경은 빼지 않는다.
  - `GDESK_TEST_MODE=1`, `GDESK_TEST_API_BASE`·`GDESK_TEST_WEB_BASE`·`GDESK_TEST_GIT_BASE`(가짜 서버), `GDESK_TEST_USER_DATA`(테스트마다 새 임시 폴더)
  - `HOME`·`USERPROFILE`을 그 임시 폴더로. 앱 시작 때의 `~/GitHub` 자동 찾기가 실제 폴더를 보지 않게 한다.
  - `ELECTRON_RENDERER_URL`과 바깥의 `GDESK_TEST_TOKEN` 제거
  - `shell.openExternal`을 기록용으로 바꾸기(`stubOpenExternal`)
- 화면 테스트는 테스트 빌드(`out/`)를 띄운다. `pnpm test:e2e`가 `GDESK_TEST_BUILD=1 GDESK_GITHUB_CLIENT_ID=gdesk-e2e-client`로 먼저 빌드한다. `playwright test`만 따로 돌리면 마지막 빌드가 무엇이었는지에 따라 테스트 모드가 꺼져 있을 수 있다.
- 가짜 서버는 GraphQL을 operationName으로, REST를 "메서드 + 경로"로 고른다. 앱에 새 GraphQL 문서나 REST 경로가 생기면 `fixtures/github/graphql.ts`·`rest.ts`에 응답을 더한다. 응답이 없는 요청은 실패로 돌아온다.
- 고정 데이터의 시각은 서버를 띄운 순간 기준 상대 시각이다. "최근 30일" 같은 기대값이 언제 돌려도 같도록 절대 날짜를 쓰지 않는다. 개수·ID는 서로 맞물려 있다(저장소의 열린 수 = 그 저장소 항목 수, 스타 수 = stargazers 길이). 데이터를 바꾸면 기대값을 쓰는 테스트를 함께 바꾼다.
- 테스트는 직렬(`workers: 1`)이다. 테스트끼리 상태를 나누지 않는다. 같은 사용자 데이터로 다시 띄우려면 `launchGdesk({ userDataDir })`.

## 구현 방식

### 앱 띄우기

```ts
import { expect, test } from './support/fixtures'
import { invoke, openedExternalUrls, waitForAppShell } from './support/helpers'

test('...', async ({ app, page, server }) => {
  await waitForAppShell(page)
}) // 토큰으로 로그인된 상태
test.describe(() => {
  test.use({ token: null }) /* 로그인 화면부터 */
})
test('...', async ({ launchGdesk }) => {
  const { page } = await launchGdesk({ env: { TZ: '...' } })
})
test.use({
  serverOptions: {
    customize: (state) => {
      /* 데이터 고치기 */
    },
    gitRepos: ['owner/name']
  }
})
```

- `invoke(page, channel, ...)`로 화면 쪽에서 IPC를 부를 수 있다.
- `openedExternalUrls(app)`로 앱이 브라우저로 열려 한 주소를 본다.
- 에디터·터미널·파일 탐색기 실행은 테스트 모드에서 기록만 되고 `invoke(page, 'local:testLaunches')`로 읽는다.
- 클론은 `serverOptions.gitRepos`로 만든 bare 저장소를 git dumb HTTP로 받는다.

### 서버 조종

| 메서드                                                                  | 효과                                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `goOffline()` / `goOnline()`                                            | 연결을 끊는다(앱은 네트워크 오류 → `offline`)                                                           |
| `setUnauthorized(true)`                                                 | 모든 API 요청 401(세션 만료)                                                                            |
| `failNextWrites(n, opts)` / `failNext(n, opts)`                         | 다음 n개 쓰기(또는 조건에 맞는 요청)를 실패시킨다. 데이터는 바뀌지 않는다                               |
| `setFineGrained(true)` / `setScopes(header)`                            | 세분화 토큰 흉내(권한 헤더 없음, 알림 403), 권한 헤더 바꾸기                                            |
| `setRateLimit({ limit, remaining })`                                    | 한도 헤더 고정                                                                                          |
| `setRateLimited(resetAt)`                                               | `/api` 요청(`/rate_limit` 제외) 403 + `x-ratelimit-remaining: 0`(1차 한도 초과). `null`이면 끈다        |
| `removeRepo(id)`                                                        | 저장소 삭제 흉내: 내 저장소·스타에서 빠지고 `/repositories/{id}`·상세 404, 그 저장소 항목·알림도 지운다 |
| `setPollInterval(s)`, `setDelay(ms)`                                    | 알림 최소 간격, 응답 지연                                                                               |
| `setDeviceFlowOutcome(o)` / `approveDeviceFlow()`                       | 기기 인증 결과(`pending`·`approve`·`deny`·`expire`·`slow_down`)                                         |
| `waitForRequest(key)`, `hasRequest`, `requestKeys()`, `clearRequests()` | 받은 요청 확인. 키는 `'GET /user'`, `'GRAPHQL GdeskMyRepositories'`, `'WEB POST /login/device/code'` 꼴 |
| `reset()`                                                               | 데이터·모드·기록을 처음으로                                                                             |

요청 기록에는 `Authorization` 헤더가 빠지고 토큰은 `token` 필드에 따로 남는다. 실패한 테스트는 메인 로그와 가짜 서버 요청 기록이 첨부된다.

### 시간대

스타 30일 창은 앱을 띄운 컴퓨터의 달력 날짜 기준이다. 날짜 경계에 걸리는 기대값은 `launchGdesk({ env: { TZ } })`로 현지 시각이 날짜 경계에서 먼 시간대를 넘긴다(`repo-detail.e2e.ts`의 `eveningTimeZone()`: 현지 18시 무렵이 되는 Etc/GMT 계열, 이름의 부호는 실제 오프셋과 반대).

## 무엇을 테스트하나

- 화면을 바꾸면 그 흐름의 화면 테스트를 더하거나 고친다. 쓰기 동작은 성공, `failNextWrites`로 실패 → 되돌림과 오류 표시, `goOffline`으로 버튼 비활성화까지 본다.
- 로그인 관련은 토큰 로그인, 잘못된 토큰, 세분화 토큰, 기기 인증 승인·거부, 401 → 만료 배너, 로그아웃을 이미 다룬다. 계정 전환은 아직 화면 테스트가 없다. 오류 보고 대화상자는 `crash.e2e.ts`가 다룬다.
- 클론 테스트의 주소 복사는 실제 시스템 클립보드를 덮어쓴다.
- 리눅스에서는 `xvfb-run -a pnpm test:e2e`. CI의 화면 테스트는 맥·리눅스에서만 돈다.
- 가짜 서버 자체를 바꾸면 `tests/unit/fake-github*.test.ts`가 통과하는지 본다.
- 새 번역 네임스페이스는 `tests/unit/locales.test.ts`가 en·ko 파일 목록과 키 집합을 비교한다.
