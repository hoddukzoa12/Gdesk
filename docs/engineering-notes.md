# 엔지니어링 노트

## 화면 데이터가 갱신되지 않는다

- **증상**: 메인에서 캐시나 연결을 바꿨는데 새 화면의 목록이 그대로다. `query:` 화면은 바뀌는데 연결 목록·설정·고정 목록만 안 바뀐다.
- **원인**: 화면의 react-query는 `staleTime: Infinity`, 창 포커스 때 다시 읽지 않음, 재시도 없음으로 설정되어 있다. `data:changed`를 받으면 `query:`로 시작하는 쿼리만 무효화한다. `local:listLinks`, `pins:list`, `settings:get`, `sync:getStatus`, `actions:getAvailability`, `updater:getStatus`, `auth:getSession`, `local:listEditors`, `app:info`는 이 대상이 아니다.
- **대응**: 이런 채널을 `useIpcQuery`로 읽는 화면은 해당 이벤트를 직접 구독한다. 연결 목록은 `data:changed`에서 `local:listLinks`를 무효화하고(`src/renderer/features/clone/hooks.ts`), 설정은 `settings:changed`, 고정은 `pins:changed`, 동기화 상태는 `sync:status`, 쓰기 가능 여부는 `actions:availability`, 세션은 `auth:changed`로 캐시를 바꾼다. 설정·동기화 상태·쓰기 가능 여부·세션은 `src/renderer/lib/hooks/`의 공용 훅이 이미 구독하므로 그 훅을 쓴다. 메인 쪽에서 캐시를 바꾸는 새 코드는 `notifyDataChanged`를 부르지 않으면 어떤 화면도 다시 읽지 않는다.
- **확인**: 바꾼 뒤 화면 테스트에서 화면이 새 값을 보이는지 본다. 단위 테스트로는 잡히지 않는다.

## 고정 변경이 두 가지 이벤트로 퍼진다

- 고정이 바뀌면 메인이 `pins:changed`(새 고정 목록)를 보내고, `src/main/index.ts`가 따로 `data:changed`(`sidebar`, `repositories`, `home`)를 보낸다. 그래서 모든 `query:*`가 다시 읽힌다.
- 계정 전환으로 고정이 지워질 때는 고정 서비스를 거치지 않으므로, `onAccountDataCleared` 구독이 `pins:changed`를 다시 보낸다. 고정을 지우는 새 경로를 만들면 이 알림도 같이 보내야 사이드바와 동기화 엔진(상세 추적 집합)이 따라온다.

## ⌘R / Ctrl+R는 화면 새로고침이 아니다

- 기본 Electron 메뉴의 "다시 불러오기"는 화면 전체를 다시 띄워 화면 상태와 진행 중인 클론 대화상자를 날린다. 그래서 앱 메뉴에서 뺐다.
- 이 단축키는 상단 막대의 데이터 새로고침(`features/sidebar/SyncFooter.tsx`)이 `keydown`으로 처리한다. 지금 주소로 범위를 정해 `sync:refresh`를 부른다.
- 앱 메뉴를 다시 만들 때 `{ role: 'reload' }`나 기본 `viewMenu`를 넣으면 단축키가 화면 재시작으로 바뀐다.
- 메뉴 틀은 `src/main/menu-template.ts`의 `buildMenuTemplate`(Electron 없는 순수 함수)이 만들고, 단위 테스트가 `reload`·`forceReload`·`viewMenu` 역할과 `+R` 단축키가 없는지 본다.
- 역할 메뉴(`fileMenu`·`editMenu` 등)의 기본 문구는 영어로만 나온다. 그래서 모든 항목에 en·ko `label`을 직접 넣는다. 언어는 설정을 따르고(`system`이면 `app.getLocale()`이 `ko`로 시작할 때 한국어), 설정의 언어가 바뀌면 `menu.ts`가 메뉴를 다시 만든다. 메뉴 문구는 화면 번역 파일이 아니라 `menu-template.ts`의 표에 있다.

## 초기화 순서 함정

- `registerAllIpc()`는 `configureGitHubClient()` 뒤에 있어야 한다. 쓰기 동작·검색 처리기가 등록 시점에 요청 계층을 가져와 구독하기 때문이다. 순서가 바뀌면 시작 때 "GitHub client is not configured" 오류가 난다.
- `configureGitHubClient()`를 두 번 부르면 오류를 던진다(구독이 끊기는 것을 막으려고). 테스트에서는 `resetGitHubClientForTests()`를 쓴다.
- `initAuth()`는 `app.whenReady()` 뒤에만 부른다. 그 전에는 `safeStorage`를 쓸 수 없어, 저장된 암호화 토큰을 읽지 못하고 로그아웃 상태로 시작하거나 새 토큰이 메모리에만 남는다.

## 단위 테스트에서 가짜 GitHub 주소를 쓰는 법

- **증상**: 테스트에서 `new GitHubClient({ ..., baseUrl })`처럼 주소를 넘겼는데 실제 `https://api.github.com`으로 요청이 간다.
- **원인**: 배포 경로의 생성자는 옵션의 주소를 무시하고 언제나 `githubApiBase()`를 쓴다. 배포 빌드에서 주소를 돌리는 통로를 없애려는 설계다.
- **대응**: 단위 테스트는 `src/main/github/client/testing.ts`의 `createGitHubClientForTests({ baseUrl, ... })`를 쓴다. 이 함수는 Vitest 실행이 아니면 생성자에서 거부된다. 앱 전체(화면 테스트)에서 주소를 바꾸려면 테스트 빌드 + `GDESK_TEST_MODE=1` + `GDESK_TEST_API_BASE`가 필요하다.

## 테스트 모드는 두 열쇠가 다 있어야 켜진다

- **증상**: `GDESK_TEST_MODE=1`을 주고 `pnpm dev`나 `pnpm build` 결과를 띄웠는데 자동 로그인·주소 바꾸기가 안 된다.
- **원인**: 테스트 모드는 빌드 때 `GDESK_TEST_BUILD=1`(→ `__GDESK_TEST_BUILD__`)과 실행 때 `GDESK_TEST_MODE=1`이 모두 있어야 켜진다. `pnpm test:e2e`만 테스트 빌드를 만든다.
- **위험**: `pnpm test:e2e` 뒤 `out/`에는 테스트 빌드(테스트 상수 참, client ID `gdesk-e2e-client`)가 남는다. 이 상태에서 `electron-builder`를 직접 돌리면 테스트 빌드가 설치 파일로 포장된다. 그 앱은 환경 변수로 API 주소를 돌리고 토큰을 넣을 수 있다. 포장은 언제나 `pnpm dist`/`pnpm dist:dir`(먼저 다시 빌드함)로 하고, CI 릴리스처럼 `pnpm build` 뒤에만 `electron-builder`를 부른다.

## Vitest가 새 번역 파일을 못 본다

- **증상**: 번역 파일을 새로 더했는데 단위 테스트에서 그 네임스페이스가 없다고 나오거나, 관계없는 테스트 수십 개가 한꺼번에 실패한다(46개가 거짓 실패한 적이 있다).
- **원인**: Vitest의 디스크 모듈 캐시(`fsModuleCache`)는 `node_modules` 안에 있다. git worktree 여러 개가 심볼릭 링크로 같은 `node_modules`를 나눠 쓰면, 다른 작업 폴더에서 변환한 오래된 `import.meta.glob` 결과가 재사용된다.
- **대응**: `vitest.config.mts`에서 `test.fsModuleCache: false`이고 `cacheDir`은 작업 폴더마다 따로인 `.vite-cache`다. 이 두 설정을 되돌리지 않는다. 비슷한 증상이 다시 나면 `.vite-cache`를 지우고 다시 돌린다.

## 패키징이 멈춘다

- **증상**: `pnpm dist`/`pnpm dist:dir`가 "searching for node modules pm=pnpm"에서 10분 넘게 CPU 0%로 멈춘다.
- **원인**: 프로젝트 폴더 안(gitignore된 폴더 아래)에 git worktree를 만들었고, 각 worktree의 `node_modules`가 루트 `node_modules`를 가리키는 심볼릭 링크였다. electron-builder의 의존성 탐색이 이 고리를 계속 돈다.
- **대응**: 프로젝트 폴더 안의 추가 worktree를 지운 뒤 서명 없는 맥 빌드(`CSC_IDENTITY_AUTO_DISCOVERY=false pnpm dist:dir`)가 정상으로 끝나 `release/mac-arm64/Gdesk.app`을 만들었다.
- **규칙**: 저장소 안에 `node_modules`를 심볼릭 링크로 공유하는 worktree가 있는 동안에는 포장하지 않는다. worktree는 저장소 폴더 밖에 만든다.
- **확인**: 포장된 앱의 `Contents/Resources/app.asar.unpacked/node_modules/dugite/git/bin/git --version`이 실행되는지 본다(확인 당시 2.53.0).

## 애플 실리콘에서 포장하는 동안 내장 git이 바뀐다

- **증상**: `pnpm dist`가 도는 동안 같은 폴더에서 테스트나 `pnpm dev`를 돌리면 내장 git을 쓰는 클론·원격 읽기가 실패한다.
- **원인**: dugite는 설치한 기계의 CPU용 git만 받는다. Intel 맥 앱을 만들 때 `electron-builder.ts`의 `beforePack`이 `node_modules/dugite/git`을 x64 git으로 바꿔 넣고, `afterPack`이 이 기계 CPU용으로 되돌린다. 그 사이에는 `node_modules`의 git이 다른 CPU용이다.
- **대응**: 포장과 테스트·개발 실행을 동시에 하지 않는다. 포장이 중간에 죽어 되돌리지 못했으면 `node node_modules/dugite/script/download-git.js`로 다시 받는다. `afterPack`은 패키지 안 git의 CPU가 앱과 다르면 빌드를 실패시킨다.

## 화면 테스트 격리

화면 테스트(`tests/e2e/support/fixtures.ts`)는 앱을 띄울 때 다음을 바꾼다. 하나라도 빠지면 개발자 컴퓨터를 건드리거나 테스트가 흔들린다.

| 바꾸는 것                                                   | 이유                                                                                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `HOME`, `USERPROFILE`을 임시 사용자 데이터 폴더로           | 앱 시작 때 클론 기본 폴더(`~/GitHub`) 자동 찾기가 개발자의 실제 폴더를 훑고 연결을 만드는 것을 막는다.                                 |
| `GDESK_TEST_USER_DATA`                                      | 테스트마다 새 DB·토큰 폴더                                                                                                             |
| 에디터·터미널·파일 탐색기 실행을 기록으로 대체              | 테스트 중 실제 프로그램이 뜨지 않는다. 기록은 `local:testLaunches`로 읽는다.                                                           |
| `shell.openExternal`을 가짜로                               | 실제 브라우저가 열리지 않는다. 연 주소는 `openedExternalUrls`로 읽는다.                                                                |
| 클론 원본을 가짜 서버의 git 저장소로(`GDESK_TEST_GIT_BASE`) | 실제 github.com에서 클론하지 않는다. 결과 폴더의 원격 주소는 그래도 표준 github.com 주소로 바뀐다.                                     |
| 테스트 빌드의 `GDESK_GITHUB_CLIENT_ID=gdesk-e2e-client`     | 기기 인증 화면은 client ID가 비어 있지 않아야 보인다. 가짜 값으로 고정해 테스트 빌드가 내장 기본값(실제 OAuth App)에 기대지 않게 한다. |
| `ELECTRON_RENDERER_URL`·바깥의 `GDESK_TEST_TOKEN` 제거      | 개발 서버나 셸에 남은 값이 섞이지 않게                                                                                                 |

- 저장소 101의 스타 테스트는 `TZ`를 현지 시각이 18시 무렵이 되는 Etc/GMT 계열 시간대(이름의 부호가 실제 오프셋과 반대)로 고정한다. 스타 30일 창이 이 컴퓨터의 달력 날짜 기준이라, 고정 데이터의 가장 오래된 스타(약 29.6일 전)가 현지 시각에 따라 창 안팎을 오가기 때문이다. 날짜 경계에 걸리는 새 기대값을 쓸 때도 같은 방식을 쓴다.
- 클론 화면 테스트의 주소 복사는 실제 시스템 클립보드를 덮어쓴다.

## 스타 창의 시간대

- 계산 함수(`src/main/domain/stars.ts`)의 기본 시간대는 UTC다. 화면 조회 계층(`src/main/queries/queries.ts`)이 이 컴퓨터의 시간대 오프셋을 넘겨서 앱에서는 현지 달력 날짜가 된다.
- 스타 시각 수집은 창보다 하루 더 앞(31일 전)부터 받는다. 시간대에 따라 날짜 경계가 달라져도 첫 날이 빠지지 않게 하려는 여유다.
- 새 집계에서 계산 함수를 직접 부를 때 오프셋을 넘기지 않으면 Home과 상세 화면 수치가 몇 시간 차이로 어긋난다.

## 알림 폴링 간격

- GitHub는 `X-Poll-Interval`(보통 60초)보다 자주 알림을 물으면 안 된다고 안내한다. 엔진은 자동 폴링 간격을 `max(60초, X-Poll-Interval)`로 잡고, 수동 새로고침으로 알림을 받아도 다음 자동 폴링을 그 시각부터 다시 미룬다.
- 조건부 요청(ETag)이 304면 한도를 거의 쓰지 않는다. ETag는 `cache_sync_state`에 있고 로그아웃하면 함께 지워진다.

## 열린 항목 수집 비용

- 들어온 PR·이슈는 내 저장소 집합의 열린 항목을 저장소 10개씩 묶어 GraphQL로 받는다. 항목마다 최근 코멘트·리뷰 50개의 작성자 관계까지 받으므로 저장소 수에 비례해 GraphQL 점수를 많이 쓴다. 저장소 100개면 5분 주기로 시간당 약 2400점으로 추정한다(시간당 5000점 한도의 절반 가까이).
- 목록 갱신은 graphql 남은 양이 5% 미만일 때만 미룬다. 저장소가 아주 많은 계정에서 한도가 부족하면 이 묶음 크기·항목 수·주기를 먼저 조정한다(`RepoOpenItemsOptions`, `DEFAULT_SYNC_INTERVALS.listsMs`).

## 클론 내부

- 대상 폴더는 직접 `mkdir`(재귀 아님)로 만들어 "이번 호출이 만들었다"를 확실히 한다. 확인과 생성 사이에 다른 프로세스가 만들었으면(`EEXIST`) 한 번 다시 살펴보고 앱 것으로 보지 않는다.
- 취소하면 execFile 콜백은 바로 오지만 git은 아직 파일을 쓰고 있을 수 있다. 실행기는 프로세스 종료를 최대 5초 기다리고 강제 종료한 뒤 2초 더 기다린 다음에야 폴더를 지운다. 이 기다림을 없애면 지운 뒤에 git이 파일을 다시 만든다.
- 진행률은 stderr를 `\r`·`\n` 기준 줄로 나눠 `Receiving objects:  45%` 같은 줄만 읽는다. `--progress`가 없으면 파이프에서는 진행률이 나오지 않는다.
- 원격 주소는 클론 뒤 `git remote set-url origin`으로 표준 주소로 다시 쓴다. 화면 테스트의 가짜 원본 주소나 리다이렉트된 주소가 남지 않게 하기 위해서다.

## 원격 주소 해석

- 받는 형식: `https://github.com/o/n(.git)(/)`, `https://user@github.com/o/n`, `git@github.com:o/n(.git)`, `ssh://git@github.com/o/n(.git)`. 호스트 대소문자는 무시한다. 쿼리·조각이 붙은 주소와 경로가 두 칸이 아닌 주소는 저장소로 보지 않는다.
- 폴더가 상위 저장소의 하위 폴더면 `rev-parse --show-toplevel`이 상위를 가리키므로 저장소가 아닌 것으로 본다. 상위 저장소를 하위 폴더의 연결로 만들지 않기 위해서다.
- `git remote -v`는 fetch·push 두 줄을 주는데 fetch 주소를 우선한다.

## 리눅스 토큰 저장

- `safeStorage.isEncryptionAvailable()`이 참이어도 리눅스에서 선택된 백엔드가 `basic_text`면 실제로는 고정 키로 가리는 수준이다. 그래서 약한 암호화로 보고 사용자에게 고르게 한다.
- 키링이 있는 데스크톱에서 개발하면 이 경로가 드러나지 않는다. 확인하려면 키링 없는 환경(헤드리스, `--password-store=basic`)에서 실행한다.

## 오류 보고가 쏟아지지 않게

- 렌더러 오류 감시는 오류 대화상자 오버레이가 마운트될 때 설치된다. 같은 오류 묶기(10초)와 실행당 3개 제한은 메인이 한다. 화면에서 따로 제한을 만들 필요는 없다.
- 메인의 `uncaughtException` 처리기는 앱 시작 직후, 창보다 먼저 설치된다. 창이 없을 때 생긴 보고서는 `crash:pending`으로 화면이 나중에 가져간다.
- 화면 테스트에서 오류 대화상자를 열려면 `crash:testTrigger`(테스트 모드 전용)를 쓴다. `main`은 다음 차례에 진짜 처리되지 않은 예외를 던지고, `renderer`는 `crash:testThrow` 이벤트로 화면이 던지게 한다.

## GitHub 기여 달력의 주는 일요일에 시작한다

- **증상**: 달력을 받은 주 배열 그대로 열로 쓰고 칸을 월~일 행에 놓으면 하루씩 밀리고, 첫 열이 비거나 마지막 열이 넘친다.
- **원인**: `contributionCalendar.weeks`는 일요일에 시작하는 주이고, 마지막 주는 오늘에서 끝나 7일보다 짧을 수 있다. Home 달력은 월요일에 시작하는 행으로 그린다.
- **대응**: 메인은 주를 펼친 하루 목록(오래된 날 → 오늘)에 `weekday`(0 = 일요일, `YYYY-MM-DD`를 UTC 자정으로 읽어 계산)를 붙여 준다. 화면의 `buildHeatmap`(`features/home/home-logic.ts`)이 `(weekday + 6) % 7`로 행을 정하고, 마지막 열이 이번 주가 되게 오른쪽에 맞춘다. GitHub 주 배열의 인덱스를 열 번호로 쓰지 않는다. 연속 기여도 날짜 문자열이 아니라 마지막 칸 = 오늘이라는 칸 순서로 센다.
- **확인**: `home-logic.test.ts`(행·열 배치, 달 이름), `src/main/domain/home-activity.test.ts`(연속 기여).

## 최근 커밋에 방금 푸시한 커밋이 없다

- **증상**: 기능 브랜치에만 푸시한 커밋은 Home 최근 커밋에 끝내 나오지 않고, 기본 브랜치에 푸시한 커밋도 몇 분 늦게 나온다.
- **원인**: REST 커밋 검색(`GET /search/commits`)은 저장소의 기본 브랜치만 색인하고 색인이 늦다.
- **대응**: 받아들인 한계다. Events API로 되돌리지 않는다. Events의 `PushEvent`는 2025-10부터 페이로드에 커밋 목록을 싣지 않아, 이벤트로 커밋을 보이려면 푸시마다 compare 요청을 더 해야 한다.
- 커밋 검색은 search 자원을 쓴다. 이 자원은 분당 한도가 작고 core·graphql과 따로 세므로, 엔진은 search가 적으면 자동 갱신에서 최근 커밋만 건너뛴다. 새 검색 요청을 자동 갱신에 넣을 때도 search 자원을 따로 본다.

## 앱에서 만든 이슈가 "내 이슈"에서 사라졌다가 다시 나타난다

- **증상**: 새 이슈를 만든 직후 목록 갱신이 돌면 "내 이슈"에서 그 이슈가 빠졌다가 몇 분 뒤 다시 나온다(유예 기록이 없을 때).
- **원인**: "내 이슈"는 검색(`author:@me`) 결과로 통째로 바꾸는데, GitHub 검색은 새 이슈를 바로 색인하지 않는다.
- **대응**: 만들 때 `cache_created_issues`에 (이슈 행, 만든 시각)을 남기고, 검색으로 목록을 바꿀 때 검색에 없고 10분(`CREATED_ISSUE_GRACE_MS`)이 안 된 기록을 목록과 전체 수에 더한다. 검색에 나오거나 시간이 지나면 기록을 지운다. 앱에서 닫으면 `forgetCreatedIssue`로 기록을 지워 닫힌 이슈가 열린 목록에 남지 않게 한다.
- 유예는 "내 이슈"에만 있다. 나를 담당자로 넣어 만든 이슈도 "나에게 할당" 탭에는 검색에 색인된 뒤에야 나온다.
- **확인**: `src/main/github/collectors/created-issues.test.ts`. 화면 테스트에서는 가짜 서버의 `setSearchIndexDelay`·`indexCreatedIssues`로 검색 지연을 흉내 낸다.

## 비공개 저장소 이슈의 이미지가 나중에 깨진다

- **증상**: 받아 둔 이슈 상세를 시간이 지나 다시 보거나 오프라인에서 보면 비공개 저장소 본문의 이미지가 깨진다.
- **원인**: `bodyHTML` 안의 비공개 이미지 주소는 짧게 만료되는 서명 주소다. 캐시에는 받을 때의 주소가 그대로 남는다. 화면은 토큰 없이 `<img>`로 직접 띄우므로 만료된 주소를 되살릴 수 없다.
- **대응**: `SafeHtml`이 불러오지 못한 이미지를 `alt`(없으면 대체 문구)로 바꾼다. 상세를 다시 받으면 새 주소가 온다. 이미지를 메인에서 토큰으로 받아 저장하는 방식은 쓰지 않는다(토큰을 쓰는 요청이 늘고 이미지 캐시가 계정 데이터가 된다).

## DOMPurify 훅은 인스턴스 전체에 퍼진다

- **증상**: 이슈 HTML 정리 규칙(체크박스가 아닌 `input` 지우기, 체크박스 `disabled`, 위험한 링크 주소 지우기)을 기본 `DOMPurify`에 훅으로 달면, 같은 기본 객체로 `DOMPurify.sanitize`를 부르는 다른 코드의 결과도 바뀐다. 정리할 때마다 훅을 달면 훅이 겹겹이 쌓인다.
- **원인**: `addHook`은 그 DOMPurify 인스턴스에 전역으로 붙는다. 모듈의 기본 내보내기는 앱 전체가 함께 쓰는 하나의 인스턴스다.
- **대응**: `sanitize.ts`가 `DOMPurify(window)`로 전용 인스턴스를 처음 한 번만 만들고 훅도 그때 한 번만 단다. 다른 용도의 정리가 필요하면 그 용도의 인스턴스를 따로 만든다.
- **확인**: `sanitize.test.ts`의 "전용 인스턴스"가 기본 인스턴스에 훅이 새지 않는지 본다.

## 이슈 상세 "다시 시도"가 같은 이슈를 다시 알리면 아무 일도 없다

- **증상**: 상세가 오지 않아 `sync:setViewedIssue`에 같은 이슈를 다시 보내도 요청이 가지 않는다.
- **원인**: 엔진은 보고 있던 이슈와 같은 이슈를 다시 알리면 받지 않는다(패널이 다시 그려질 때마다 요청이 가지 않게).
- **대응**: `null`을 먼저 보내고 끝난 뒤 이슈를 다시 보낸다(`IssueDetailPanel`의 다시 시도). 다른 화면에서 강제로 다시 받게 할 때도 같은 순서를 쓴다.

## iCloud로 동기화되는 폴더에서 서식 검사가 시간 초과로 실패한다

- **증상**: `pnpm exec prettier --check .`가 `ETIMEDOUT`으로 실패한다. 코드는 바뀌지 않았다.
- **원인**: 프로젝트가 iCloud로 동기화되는 데스크톱 폴더 아래에 있어, iCloud가 빌드 결과 폴더 `release/` 안에 이름 끝에 " 2"가 붙은 중복 파일을 만들었다. 이 파일들을 훑다가 `ETIMEDOUT`이 났다.
- **대응**: `release/`는 빌드 결과이므로 지운다(`rm -rf release`). 다시 나면 `find . -name "* 2*" -not -path "./node_modules/*" -not -path "./.git/*"`로 중복 파일을 찾는다. 프로젝트를 iCloud 동기화 밖에 두면 생기지 않는다.

## 단위 테스트 시간 제한이 20초인 이유

- **증상**: git·Electron 프로세스를 띄우는 단위 테스트가 전체를 병렬로 돌릴 때만 기본 5초 제한에 걸려 실패하고, 따로 돌리면 통과한다.
- **원인**: 병렬 실행 부하로 프로세스 시작이 늦어진다.
- **대응**: `vitest.config.mts`의 `testTimeout`·`hookTimeout`을 20초로 둔다. 기본값으로 되돌리면 같은 거짓 실패가 다시 난다.

## 새 기능을 붙일 때의 확인 목록

1. 채널 계약(`src/shared/ipc/<기능>.ts`) → 처리기(`src/main/<기능>/<기능>.ipc.ts`의 `registerIpc`) → 화면 호출. 세 군데의 채널 이름이 같은지 typecheck로 확인한다.
2. 메인 처리기에서 요청 값을 검사한다. 잘못된 저장소 ID·범위·경로가 오는 단위 테스트를 둔다.
3. 캐시를 바꾸면 `notifyDataChanged`, `query:`가 아닌 채널을 읽는 화면은 이벤트 구독. 화면 테스트에서 새 값이 보이는지 확인한다.
4. 문구는 `en`·`ko` 둘 다. `pnpm test`의 번역 키 검사로 확인한다.
5. GitHub 요청을 새로 하면 가짜 GitHub 서버(`tests/fixtures/github`)에 응답을 더하고, GraphQL이면 `OPERATIONS`에 이름을 등록한다. `server.requestKeys()`로 실제로 그 요청이 갔는지 본다.
6. 쓰기면 막힘(`getAvailability`)을 확인하고, 실패 시 되돌림을 `server.failNextWrites()`로 화면 테스트한다.
7. GraphQL mutation은 가짜 서버의 `MUTATIONS`(`tests/fixtures/github/graphql.ts`)에 처리기를 등록한다. 응답만 받는 POST(`POST /markdown` 같은)는 `READ_ONLY_POSTS`(`tests/fixtures/github/server.ts`)에 더한다. 빠지면 `failNextWrites`가 쓰기 수를 잘못 센다(mutation을 쓰기로 세지 않거나, 읽기 POST를 쓰기로 세어 실패시킨다).
8. `pnpm typecheck && pnpm lint && pnpm test && pnpm exec prettier --check . && pnpm test:e2e`.
