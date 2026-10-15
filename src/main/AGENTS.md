# src/main — 메인 프로세스

## 맡는 것

GitHub API 호출, 토큰, 내장 git 실행, SQLite, 파일 시스템, 외부 프로그램 실행, 자동 갱신, 업데이트, 오류 보고 수집. 화면이 하는 모든 요청의 처리기(`*.ipc.ts`)가 여기 있다.

## 맡지 않는 것

- 화면 표시와 문구. 메인은 번역된 문장을 만들지 않고 코드(`reason`, `code`, `kind`)를 돌려준다. 예외는 토큰을 지운 git 원문 같은 `detail`·`message`뿐이다.
- 도메인 타입·상태 값 집합·IPC 계약의 정의. 그것은 `src/shared`에 있고 여기서는 가져다 쓴다.
- `src/renderer`의 코드. import하지 않는다.
- `src/preload`. 프리로드는 `invoke`·`on`만 노출하며 기능 변경에서 고치지 않는다.

## 폴더

| 폴더                           | 역할                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `index.ts`                     | 시작 순서. 서비스 초기화를 더하는 유일한 공유 파일                                      |
| `config.ts`                    | 빌드 상수, `isTestMode()`, `githubApiBase()`, `githubWebBase()`                         |
| `ipc/`                         | `handle`, `emit`, `registerAllIpc`(glob), `notifyDataChanged`                           |
| `db/`                          | 연결, 마이그레이션 수집, `withTransaction`, 로컬 연결 테이블, 계정 정보, 계정 단위 삭제 |
| `pins/`, `settings/`           | 고정, 설정 서비스와 IPC                                                                 |
| `github/client/`               | 요청 계층(연결 상태의 유일한 출처), 한도 추적, 오류 분류, 토큰 지우기                   |
| `github/collectors/`           | GraphQL 문서·operationName, 응답 → 레코드, `refresh*`(받아서 캐시에 반영)               |
| `domain/`                      | 순수 계산(CI, 리뷰, 응답 없는 새 기여, 실패한 CI, 스타 창, 작성자, 알림 주소)           |
| `cache/`                       | `cache_*` 테이블, 마이그레이션, 정리 함수, Home·사이드바 집계, 로컬 검색                |
| `auth/`                        | 로그인 서비스, 기기 인증, 토큰 확인, 토큰 저장소                                        |
| `sync/`                        | 동기화 엔진(순수), 앱 연결, 창 열림 추적                                                |
| `queries/`                     | `query:*` 처리기(캐시만 읽음)                                                           |
| `actions/`                     | 쓰기 동작 서비스                                                                        |
| `git/`                         | dugite 실행기, 클론, 원격 해석, askpass                                                 |
| `local/`                       | 클론·자동 찾기·연결·열기 서비스, 에디터 감지, 실행기                                    |
| `search/`                      | 로컬 검색, GitHub 저장소 검색                                                           |
| `crash/`                       | 오류 수집, 지우기, 보고서, 이슈 주소                                                    |
| `updater/`                     | 업데이트 방식 결정, 상태 기계, electron-updater 연결                                    |
| `app/`, `window.ts`, `menu.ts` | 앱 정보, 외부 링크, 폴더 대화상자, 창 보안, 메뉴                                        |

## 반드시 지킬 것

- 토큰은 `auth/`의 서비스 안에만 있다. 다른 곳은 `getToken()`·`tokenProvider`로 그때그때 받는다. IPC 응답·이벤트, `console.*`, 오류 문구, 오류 보고, git 인자, 원격 주소, `.git/config`에 넣지 않는다. 요청 계층 오류 문구는 `redact()`를 거친다.
- GitHub로 가는 요청은 `github/client`의 `GitHubClient`만 보낸다. 예외는 저장 전 후보 토큰을 확인하는 `token-validate.ts`와 기기 인증 `device-flow.ts`다. 둘 다 주입된 fetch를 쓰고 주소는 `githubApiBase()`·`githubWebBase()`에서 받는다.
- GitHub 이외의 호스트로 네트워크 요청을 하지 않는다. 업데이트는 electron-updater의 github 공급자만 쓴다.
- 연결 상태는 `GitHubClient`만 정한다. 다른 서비스는 `getStatus()`·`onStatusChange()`로 읽기만 한다. 우선순위는 `session_expired` > `offline` > `rate_limited` > `online`.
- 폴더를 지우는 코드는 `git/clone.ts`의 정리 하나뿐이고, 그 클론이 `mkdir`로 새로 만든 대상 폴더만 지운다. 연결 해제·계정 전환·자동 찾기는 DB 행만 바꾼다. askpass 임시 폴더는 앱이 `mkdtemp`로 만든 것이라 예외다.
- 고정·로컬 연결·저장소 캐시는 숫자 저장소 ID로 식별한다. 이름으로 찾는 곳은 원격 주소 → ID 풀이(`local.service.ts`의 `cachedRepoId`, `lookupRepo`)뿐이다.
- 로그아웃은 `clearFetchedData`(`cache_*`만), 다른 계정 로그인은 `clearAccountData`(`cache_*` + `pins` + `local_links`)다. 설정과 `account_meta`의 마지막 사용자 ID는 어느 쪽에서도 지우지 않는다.
- 테스트용 덮어쓰기(주소, 토큰, 사용자 데이터 폴더, git 원본, 실행 기록, 일부러 오류 내기)는 모두 `isTestMode()`로 감싼다. `isTestMode()`는 빌드 상수 `__GDESK_TEST_BUILD__`와 `GDESK_TEST_MODE=1`이 모두 있어야 참이다.
- `query:*` 처리기는 캐시만 읽고 GitHub에 요청하지 않는다.
- 쓰기 동작은 `online` + 로그인일 때만 하고, 실패하면 캐시를 이전 값으로 되돌린다. 대기열을 두지 않는다.

## 구현 방식

- **로직과 Electron 분리.** 서비스는 바깥 의존(DB 가져오기, 클라이언트, 세션, 시계, 스케줄러, 실행기)을 생성자·옵션으로 받는다(`SyncEngine`, `LocalService`, `createActionsService`, `createCrashService`, `createUpdaterService`, `TokenStore`). Electron import는 `index.ts`·`electron.ts`·`*.ipc.ts`·`updater.ts`·`window.ts`에 둔다. 그래야 Vitest가 Node만으로 돈다.
- **IPC 처리기.** `src/shared/ipc/<기능>.ts`를 side-effect import(`import '@shared/ipc/<기능>'`)해 채널 타입을 불러오고, `registerIpc()` 안에서 `handle(channel, fn)`으로 등록한다. DB·서비스는 처리기 안에서 호출 시점에 가져온다. 화면에서 온 값은 다시 검사한다(`assertRepoId`, `parseRefreshScope`, `validateSettingsPatch`). 이벤트는 `emit`, 캐시 변경은 `notifyDataChanged(keys)`.
- **예상 가능한 실패는 결과 값으로.** 막힘·GitHub 실패·폴더 문제는 `{ ok: false, reason }` 등으로 돌려준다. 던지는 것은 잘못된 요청뿐이다.
- **수집 → 캐시.** `collect*`는 받아서 레코드로 바꾸기만 하고, `refresh*`가 한 트랜잭션으로 캐시에 반영하고 `cache_sync_state`에 시각을 남긴다. 조직 접근 제한은 수집 전체를 실패시키지 않고 `recordOrgRestrictions`로 남긴다. 네트워크·한도·세션 오류는 다시 던져 요청 계층의 상태 관리에 맡긴다.
- **목록 쓰기.** 불완전한 결과(페이지 한도, 조직 제한)로 기존 목록을 줄이지 않는다. 저장소 범위는 `window` 모드로 합치고, 검색 목록은 첫 페이지부터 비어 있으면 그대로 둔다.
- **GraphQL.** 새 문서는 `collectors/queries.ts`에 두고 고유한 `Gdesk*` operationName을 `OPERATIONS`에 더한다.
- **마이그레이션.** `<기능>/<이름>.migration.ts`, 새 ID는 기존보다 큰 접두사. 배포된 마이그레이션은 고치지 않는다. 새 `cache_` 테이블은 `cache/cleaner.ts`의 `CACHE_TABLES`에 더한다.
- **트랜잭션.** 여러 행 쓰기는 `withTransaction`. 중첩되면 SAVEPOINT가 된다.
- **싱글턴.** `getDb()`, `getAuthService()`, `getGitHubClient()`, `getSyncEngine()`, `getLocalService()`는 `index.ts`의 초기화 뒤에만 쓸 수 있다. `configureGitHubClient()`는 한 번만 부를 수 있고, 테스트는 `reset*ForTests()`를 쓴다.
- **외부 프로그램.** `spawn`은 `shell: false`와 인자 배열로만. 외부 링크는 `openExternalSafe`로 http(s)만.

## 테스트

- 위치: 각 파일 옆 `*.test.ts`. 환경은 node.
- DB: `openDatabase(':memory:')`로 실제 마이그레이션을 적용한 메모리 DB를 쓴다.
- GitHub: 수집기 테스트는 `github/collectors/test-server.ts`의 가짜 fetch(GraphQL은 operationName, REST는 "메서드 경로"로 응답)를 `createGitHubClientForTests({ baseUrl })`로 만든 클라이언트에 넣는다. `new GitHubClient({ baseUrl })`는 주소를 무시하므로 쓰지 않는다. 요청 계층 자체는 fetch를 직접 주입해 테스트한다.
- git: `git/test-helpers.ts`·`local/test-helpers.ts`의 임시 폴더와 로컬 bare 원격. 실제 github.com에 접속하지 않는다.
- 시간: 엔진·한도·기기 인증은 `now`·`scheduler`·`sleep`을 주입해 가짜 시계로 돌린다.
- 반드시 테스트가 있어야 하는 규칙과 엣지:
  - CI 통합 상태 매핑(모르는 값 → `none`), 리뷰 상태 매핑.
  - 응답 없는 새 기여: 쓰기 권한자 관계 3종, 봇, 표본(50개)보다 응답이 많고 쓰기 권한자가 안 보일 때 응답한 것으로 보기.
  - 실패한 CI 카드: 추적 순서, 중복, 상세 없음.
  - 스타 창: 시간대 오프셋, 날짜 경계, 7일 합 = 30일 마지막 7칸, 잘림.
  - 원격 주소 해석(HTTPS·SSH·scp형·`.git`·대소문자·쿼리 거부), 하위 폴더를 저장소로 보지 않기, origin·upstream 양쪽 연결, 옛 이름 → ID.
  - 세션: 로그아웃 삭제 범위, 계정 전환 삭제 범위, 같은 계정 재로그인, 마지막 사용자 ID 유지, 늦게 끝난 로그인 시도 버리기.
  - 토큰 저장: 리눅스 약한 암호화 선택, 리눅스 아닌 OS의 암호화 불가 → 메모리, 손상 파일 삭제, 파일 권한 0600.
  - 요청 계층: 1·2차 한도 분류, 막힘 동안 요청 안 보냄, 회복 타이머, 401 → 다시 로그인 전까지 요청 안 보냄, API 주소 밖 링크 거부, 테스트가 아닐 때 주소 덮어쓰기 거부.
  - 클론: HTTPS 뒤 `.git/config`·원격에 토큰 없음, 실패·취소 시 이번에 만든 폴더만 지움, 원래 있던 빈 폴더는 남김, 비어 있지 않은 대상 → `exists`.
  - 쓰기 동작: 막힘 우선순위, 실패 되돌림, 같은 대상 직렬화.
  - 알림 완료 기록: 같은 시각 재등장 숨김, 새 활동이면 다시 보임.
  - 오류 보고 지우기: 토큰 모양, 홈·사용자 폴더, GitHub 주소, 저장소·소유자·로그인 이름, 단어 경계.
