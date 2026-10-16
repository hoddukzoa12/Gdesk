# 외부 인터페이스 계약

Gdesk는 공개 API나 서버가 없다. 바깥에서 기대어 쓰는 경계는 두 가지다.

1. 메인 프로세스가 화면(렌더러)에 내놓는 IPC 채널. 화면 코드와 화면 테스트가 이 계약의 소비자다.
2. 빌드할 때 넣는 값. 설치 파일을 만드는 사람(CI 포함)이 소비자다.

## IPC 공통 규칙

### 접근

- 화면에서는 `window.gdesk` 하나만 보인다. 함수는 두 개다.
  - `invoke(channel, request?) → Promise<response>`: 요청-응답. 요청 값이 `void`인 채널은 인자 없이 부른다.
  - `on(event, listener) → unsubscribe`: 메인이 모든 창에 보내는 이벤트 구독. 돌려받은 함수로 끊는다.
- 인증 절차는 없다. 같은 앱의 창이면 모든 채널을 부를 수 있다. 채널 이름과 요청 모양은 실행 중에 강제되지 않으므로, 메인 처리기가 요청 값을 다시 검사한다.
- 채널 이름은 `<기능>:<동작>`이다. 계약은 `src/shared/ipc/<기능>.ts`의 타입 선언이 정본이다.

### 값

- 요청·응답·이벤트는 구조화 복제가 되는 평범한 값이다. 함수·클래스 인스턴스·`Buffer`는 오가지 않는다.
- 시각: 숫자면 epoch ms, 문자열이면 GitHub가 준 ISO 8601 그대로다.
- 저장소 ID는 GitHub 숫자 저장소 ID(양의 안전한 정수)다. PR·이슈 `id`는 GraphQL 노드 ID, 알림은 스레드 ID 문자열이다.
- 어떤 응답·이벤트에도 GitHub 토큰은 없다.

### 오류

| 종류         | 화면에서 보이는 모습                                                                          | 언제                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 결과 값 실패 | 정상 응답 안의 `ok: false`·`kind: 'failed'`·`status` 등                                       | 예상 가능한 실패(막힘, GitHub 실패, 폴더 문제). 대부분 채널이 이 방식이다.                                  |
| 거부(reject) | `invoke`의 Promise가 거부되고 메시지가 `Error invoking remote method '<채널>': Error: <문구>` | 요청 값이 잘못됨(저장소 ID·탭·범위·설정 패치), 고정 순서 집합 불일치, 테스트 전용 채널을 배포 빌드에서 부름 |

거부 문구는 개발자용 영어 문장이고 화면에 그대로 보이지 않는다. 결과 값의 `reason`·`code`는 화면이 번역하는 고정된 코드다.

### 캐시 변경 알림

`data:changed { keys: string[] }`는 메인의 캐시(받아온 정보·연결)가 바뀌었음을 알린다. 키 집합은 `home`, `inbox`, `pulls`, `reviews`, `issues`, `starred`, `repositories`, `sidebar`, `repo:<ID>`, `issue:<저장소 ID>#<번호>`다. 화면은 키와 관계없이 `query:`로 시작하는 조회를 모두 다시 읽는다. `query:`가 아닌 채널의 값은 해당 이벤트로 따로 따라가야 한다.

## 요청-응답 채널

### 앱

| 채널                  | 요청               | 응답                                                                | 실패                                       |
| --------------------- | ------------------ | ------------------------------------------------------------------- | ------------------------------------------ |
| `app:info`            | 없음               | `{ name, version, platform: 'darwin'\|'win32'\|'linux', testMode }` | —                                          |
| `app:openExternal`    | `{ url }`          | `{ opened }`                                                        | http(s)가 아니면 열지 않고 `opened: false` |
| `dialog:chooseFolder` | `{ defaultPath? }` | `{ path: string \| null }`                                          | 취소하면 `null`. 폴더 만들기를 허용한다.   |

### 로그인

모든 응답은 `SessionSnapshot` 또는 그것을 담은 `AuthResult`다.

`SessionSnapshot`: `state`(`signed_out`·`signing_in`·`signed_in`·`expired`), `user`(`{ id, login, name, avatarUrl }` 또는 `null`), `tokenKind`(`classic`·`fine_grained`·`oauth`·`null`), `missingScopes`(`{ scope, impact }[]`), `inboxAvailable`, `deviceFlowAvailable`, 선택 `deviceFlow`(`{ userCode, verificationUri, expiresAt, status }`), 선택 `storagePrompt`(`'linux_insecure'`).

| 채널                         | 요청                           | 응답                                                                                                           | 실패                                                                                                  |
| ---------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `auth:getSession`            | 없음                           | `SessionSnapshot`                                                                                              | —                                                                                                     |
| `auth:loginWithToken`        | `{ token }`                    | `AuthResult`                                                                                                   | `{ ok: false, error: 'empty_token'\|'invalid_token'\|'offline'\|'http_error'\|'cancelled', session }` |
| `auth:startDeviceFlow`       | 없음                           | 코드를 받으면 바로 `{ ok: true, session }`(승인을 기다리지 않음). 진행은 `auth:changed`의 `deviceFlow`로 온다. | `device_flow_unavailable`(client ID 없음), `offline`, `http_error`, `cancelled`                       |
| `auth:cancelDeviceFlow`      | 없음                           | `SessionSnapshot`. 진행 중이면 `cancelled`로, 이미 끝났으면 표시를 지운다.                                     | —                                                                                                     |
| `auth:openVerificationUri`   | 없음                           | `{ opened }`                                                                                                   | 대기 중이 아니거나 http(s)가 아니면 `false`                                                           |
| `auth:logout`                | 없음                           | `SessionSnapshot`(`signed_out`)                                                                                | —                                                                                                     |
| `auth:chooseInsecureStorage` | `{ choice: 'save'\|'memory' }` | `SessionSnapshot`                                                                                              | 다른 값은 무시하고 지금 세션을 돌려준다                                                               |

### 화면 조회(캐시만 읽음, GitHub 요청 없음)

| 채널                    | 요청                                                                                     | 응답                                                                                                                                                                                                                                                   | 실패(거부)               |
| ----------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| `query:home`            | 없음                                                                                     | `HomeSummary`: `reviewRequests`·`unreadNotifications`·`unansweredContributions`(각 `{ count, items(최대 5), complete }`), `failedCi`(`{ repos, pullRequests }`), `starChanges`(`{ windowDays, items: { repoId, repoFullName, gained, truncated }[] }`) | —                        |
| `query:inbox`           | `{ unreadOnly?, repoId?, reason? }`                                                      | `{ items: NotificationRow[], complete, inboxAvailable }`                                                                                                                                                                                               | 저장소 ID·형식이 잘못됨  |
| `query:pulls`           | `{ tab: 'incoming'\|'mine' }`                                                            | `ListPage<PullRequestRow>` = `{ items, totalCount, complete }`                                                                                                                                                                                         | 모르는 탭                |
| `query:reviews`         | 없음                                                                                     | `ListPage<PullRequestRow>`                                                                                                                                                                                                                             | —                        |
| `query:issues`          | `{ tab: 'incoming'\|'assigned'\|'mine' }`                                                | `ListPage<IssueRow>`                                                                                                                                                                                                                                   | 모르는 탭                |
| `query:starred`         | `{ search? }`                                                                            | `RepositorySummary[]`(스타한 시각 최신순)                                                                                                                                                                                                              | `search`가 문자열이 아님 |
| `query:repositories`    | `{ includeForks?, includeArchived?, owner?, sort?: 'pushed'\|'name'\|'stars', search? }` | `{ items: RepositorySummary[], owners: { login, type, count }[] }`                                                                                                                                                                                     | 잘못된 정렬·형식         |
| `query:sidebar`         | 없음                                                                                     | `{ counts: { unreadNotifications, incomingPullRequests, reviewRequests }, pinned: SidebarPinnedItem[], yourRepositories: SidebarRepoItem[] }`                                                                                                          | —                        |
| `query:repoDetail`      | `{ repoId }`                                                                             | `{ detail: RepositoryDetail, accessStatus, pinned }` 또는 캐시에 없으면 `null`                                                                                                                                                                         | 잘못된 저장소 ID         |
| `query:orgRestrictions` | 없음                                                                                     | `{ orgLogin \| null, reason: 'oauth_app_restriction'\|'saml_enforcement', message, recordedAt }[]`                                                                                                                                                     | —                        |

- `RepositoryDetail`은 상세 수집 전이면 머리글 외 목록이 비어 있고 `detailSyncedAt`이 `null`이다.
- `SidebarPinnedItem.cached`가 `false`면 캐시에 행이 없는 고정이고, 이름·수치가 `null`, `accessStatus`는 `unavailable`이다.
- 상태 값 집합: CI `passing`·`failing`·`pending`·`none`, 리뷰 `approved`·`changes_requested`·`review_required`·`none`, PR `open`·`draft`, 알림 `unread`·`read`, 저장소 `available`·`unavailable`.

### 동기화

| 채널                 | 요청                                                                                               | 응답                                                                                            | 실패                    |
| -------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------- |
| `sync:getStatus`     | 없음                                                                                               | `SyncStatus`: `{ connection, lastSyncedAt, rateLimitedUntil, syncing, orgRestrictions }`        | —                       |
| `sync:refresh`       | `{ scope: 'home'\|'inbox'\|'pulls'\|'reviews'\|'issues'\|'starred'\|'repositories'\|'repo:<ID>' }` | 없음. 받기·저장이 끝난 뒤 돌아온다. 로그인·연결 상태가 맞지 않으면 아무것도 하지 않고 돌아온다. | 모르는 범위면 거부      |
| `sync:setViewedRepo` | `{ repoId: number \| null }`                                                                       | 없음. 상세 받기를 기다리지 않고 바로 돌아온다.                                                  | 잘못된 저장소 ID면 거부 |

### 쓰기 동작

`ActionResult`: `{ ok: true }` | `{ ok: false, reason: 'session_expired'\|'signed_out'\|'offline'\|'rate_limited' }`(요청·캐시 변경 없음) | `{ ok: false, reason: 'failed', message }`(캐시를 되돌림, 문구는 화면에 보여도 됨).

| 채널                      | 요청                  | 응답                                                      | 비고                                                                                |
| ------------------------- | --------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `actions:star`            | `{ repoId, starred }` | `ActionResult`                                            | `starred: true` 스타, `false` 취소. 캐시에 없는 저장소는 `failed`. 거부하지 않는다. |
| `actions:markRead`        | `{ threadId }`        | `ActionResult`                                            | —                                                                                   |
| `actions:markDone`        | `{ threadId }`        | `ActionResult`                                            | 성공하면 목록에서 사라진다                                                          |
| `actions:getAvailability` | 없음                  | `{ available: true }` 또는 `{ available: false, reason }` | 바뀌면 `actions:availability`                                                       |

같은 대상의 동작은 앞 동작이 끝난 뒤 실행되므로, 응답 순서는 같은 대상 안에서 호출 순서와 같다.

### 이슈 쓰기 동작

막힘은 위와 같다(`actions:getAvailability`·`actions:availability`). 잘못된 요청 값(이슈 키, 반응 종류, 상태·닫기 이유, 저장소 ID, 형식)은 거부한다. 실패 결과는 `{ ok: false, reason }`이고 `reason`은 막힘 4종, `not_allowed`(viewerCan\*가 false), `not_cached`(상세를 받은 적 없음·모르는 반응 대상), `empty_body`, `empty_title`, `repo_not_mine`, `repo_fork`, `repo_archived`, `repo_issues_disabled`, 또는 `failed`(+`message`)다.

| 채널                           | 요청                                             | 응답                                                        | 비고                                                                                            |
| ------------------------------ | ------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `issueActions:react`           | `{ subjectId, issueRef, content, add }`          | `IssueActionResult`                                         | 이슈·코멘트 노드 ID. 상세 캐시를 먼저 바꾸고 실패하면 되돌린다                                  |
| `issueActions:comment`         | `{ issueRef, body }`                             | `IssueActionResult`                                         | 성공하면 새 코멘트를 상세에 붙이고 수를 늘린다                                                  |
| `issueActions:setState`        | `{ issueRef, state: 'open'\|'closed', reason? }` | `IssueActionResult`                                         | `reason`: `completed`(기본)·`not_planned`. 상세를 먼저 바꾸고, 성공하면 이슈 목록을 새로 받는다 |
| `issueActions:create`          | `{ repoId, title, body?, labels?, assignees? }`  | `{ ok: true, issue: { repoId, number, nodeId } }` 또는 실패 | 내 저장소(포크·보관 아님, 이슈 켬)만. 성공하면 "내 이슈" 목록에 바로 넣는다                     |
| `issueActions:repoMeta`        | `{ repoId }`                                     | `{ ok: true, labels, assignees }` 또는 실패                 | GitHub 에서 바로 받는다(캐시 없음). 새 이슈와 같은 저장소 조건                                  |
| `issueActions:previewMarkdown` | `{ repoId, text }`                               | `{ ok: true, html }` 또는 실패                              | GitHub 가 만든 HTML 그대로(화면이 안전하게 그린다). 빈 글은 요청 없이 `''`                      |

같은 이슈에 대한 반응·코멘트·닫기·다시 열기는 앞 동작이 끝난 뒤 실행된다. 성공한 쓰기는 `data:changed`로 `issues`, `home`, `issue:<저장소 ID>#<번호>`를 알린다.

### 고정

모든 응답은 바뀐 뒤의 전체 고정 목록 `{ repoId, position }[]`(위치 순)이다.

| 채널           | 요청          | 실패(거부)                               |
| -------------- | ------------- | ---------------------------------------- |
| `pins:list`    | 없음          | —                                        |
| `pins:pin`     | `{ repoId }`  | 잘못된 저장소 ID. 이미 고정이면 그대로   |
| `pins:unpin`   | `{ repoId }`  | 잘못된 저장소 ID. 고정이 아니면 그대로   |
| `pins:reorder` | `{ repoIds }` | 지금 고정 목록과 정확히 같은 집합이 아님 |

### 설정

| 채널              | 요청           | 응답                                                                         | 실패(거부)                                                                             |
| ----------------- | -------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `settings:get`    | 없음           | `{ cloneBaseDir, cloneProtocol, defaultEditor, language, theme, homeCards }` | —                                                                                      |
| `settings:update` | 일부 필드 패치 | 저장 뒤 전체 설정                                                            | 모르는 키, 잘못된 값, 상대 경로, Home 카드 중복 ID. 거부되면 아무것도 저장하지 않는다. |

### 로컬 폴더·클론·열기

| 채널                | 요청                                                                 | 응답                                                                                                                             | 실패(결과 값)                                                                                                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local:listLinks`   | `{ repoId? }`                                                        | `{ id, repoId, path, lastUsedAt, status: 'ok'\|'missing', accessStatus: 'available'\|'unavailable', fullName }[]`, 최근 사용 순  | —                                                                                                                                                                                                                                                                           |
| `local:listEditors` | 없음                                                                 | `{ id, name }[]`(설치된 것만)                                                                                                    | —                                                                                                                                                                                                                                                                           |
| `local:clone`       | `{ cloneId, repoId, owner, name, targetDir? }`                       | 끝날 때까지 기다린다. `{ kind: 'cloned', path, link }` / `{ kind: 'exists', path, remotes, sameRepo }` / `{ kind: 'cancelled' }` | `{ kind: 'failed', code, detail }`. `code`: `signed_out`, `session_expired`, `offline`, `rate_limited`, `invalid_request`, `invalid_target`, `already_running`, `auth_failed`, `ssh_auth`, `not_found`, `network`, `target_error`, `git_error`. `detail`은 토큰을 지운 원문 |
| `local:cancelClone` | `{ cloneId }`                                                        | `{ cancelled }`(진행 중인 것이 없으면 `false`)                                                                                   | —                                                                                                                                                                                                                                                                           |
| `local:rescan`      | 없음                                                                 | `{ found, added, missing }`                                                                                                      | 겹친 요청은 합친다                                                                                                                                                                                                                                                          |
| `local:link`        | `{ path, repoId? }`                                                  | `{ ok: true, links }`(포크는 두 개일 수 있음)                                                                                    | `{ ok: false, reason }`: `path_not_found`, `not_git`, `not_github`, `different_repo`, `unresolved`                                                                                                                                                                          |
| `local:unlink`      | `{ linkId }`                                                         | `{ removed }`                                                                                                                    | 폴더는 지우지 않는다                                                                                                                                                                                                                                                        |
| `local:relink`      | `{ linkId, path }`                                                   | `{ ok: true, links: [새 연결] }`(ID가 바뀔 수 있음)                                                                              | `link_not_found` 및 `local:link`의 이유                                                                                                                                                                                                                                     |
| `local:open`        | `{ linkId, target: 'editor'\|'terminal'\|'fileManager', editorId? }` | `{ ok: true }`                                                                                                                   | `{ ok: false, reason, detail? }`: `link_not_found`, `missing`, `no_editor`, `unknown_editor`, `no_terminal`, `launch_failed`                                                                                                                                                |

- `cloneId`는 화면이 만든다. 진행률 이벤트와 취소에 쓴다.
- `exists`의 `remotes`는 `{ name, url, repo: { owner, name } \| null }[]`이고 주소의 사용자 정보는 지워져 있다. `sameRepo`가 참이면 화면은 `local:link`로 "이 폴더 연결"을 제안한다.

### 검색

검색어는 앞뒤 공백을 지우고 256자로 자른다. 2자 미만이면 빈 결과, 구역마다 최대 10개.

| 채널            | 요청       | 응답                                                                                                                                                                                                                                                                  |
| --------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search:local`  | `{ text }` | `{ repositories, pullRequests, issues }`(캐시만, 오프라인에서도)                                                                                                                                                                                                      |
| `search:github` | `{ text }` | `{ status: 'ok', items: { id, owner, ownerAvatarUrl, name, fullName, description, url, private, fork, archived, stargazerCount, primaryLanguage, pushedAt }[] }` 또는 `{ status: 'offline'\|'rate_limited'\|'error' }`(문구 없음). `online`이 아니면 요청하지 않는다. |

### 오류 보고

`CrashReport`: `{ id, process: 'main'\|'renderer', appVersion, osName, osVersion, message, stack, title, body, sendMode: 'issue'\|'copy' }`. 모든 글은 이미 지운 것이다.

| 채널                   | 요청                            | 응답                                                                                     |
| ---------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `crash:reportRenderer` | `{ message, stack? }`           | `{ accepted }`. 묶이거나 실행당 한도를 넘거나 모양이 틀리면 `false`                      |
| `crash:pending`        | 없음                            | 닫지 않은 `CrashReport[]`                                                                |
| `crash:dismiss`        | `{ id }`                        | 없음                                                                                     |
| `crash:openIssue`      | `{ id }`                        | `{ opened, truncated }`. `sendMode`가 `issue`가 아니거나 저장소가 없으면 `opened: false` |
| `crash:copy`           | `{ id }`                        | `{ copied }`. 없는 ID면 `false`                                                          |
| `crash:testTrigger`    | `{ where: 'main'\|'renderer' }` | `{ accepted }`. 테스트 모드가 아니면 언제나 `false`                                      |

### 업데이트

`UpdaterStatus`: `{ state, mode: 'auto'\|'notify'\|'off', currentVersion, version, progress, checkedAt, error }`. `state`는 `disabled`·`unavailable`·`idle`·`checking`·`up_to_date`·`available`·`downloading`·`ready`·`error`.

| 채널                       | 요청 | 응답                                                              |
| -------------------------- | ---- | ----------------------------------------------------------------- |
| `updater:getStatus`        | 없음 | `UpdaterStatus`                                                   |
| `updater:check`            | 없음 | `UpdaterStatus`. 이미 확인·다운로드 중이거나 준비됐으면 지금 상태 |
| `updater:install`          | 없음 | `{ accepted }`. `ready`일 때만 참이고, 응답 뒤 앱이 재시작된다    |
| `updater:openDownloadPage` | 없음 | `{ opened }`                                                      |

### 테스트 모드 전용

| 채널                 | 요청 | 응답                                                                   | 배포 빌드에서 |
| -------------------- | ---- | ---------------------------------------------------------------------- | ------------- |
| `local:testLaunches` | 없음 | 띄우려 한 실행 기록 `{ kind: 'spawn'\|'openPath', command?, path? }[]` | 거부          |

## 이벤트 채널

| 이벤트                 | 값                                             | 언제                                       |
| ---------------------- | ---------------------------------------------- | ------------------------------------------ |
| `data:changed`         | `{ keys }`                                     | 캐시·연결이 바뀜                           |
| `auth:changed`         | `SessionSnapshot`                              | 세션이 바뀔 때마다                         |
| `sync:status`          | `SyncStatus`                                   | 값이 실제로 바뀔 때만                      |
| `actions:availability` | `{ available }`/`{ available: false, reason }` | 값이 실제로 바뀔 때만                      |
| `pins:changed`         | `{ pins }`                                     | 고정이 바뀜, 계정 전환으로 지워짐          |
| `settings:changed`     | 전체 설정                                      | 설정이 저장됨                              |
| `local:cloneProgress`  | `{ cloneId, phase, percent }`                  | 클론 진행 중                               |
| `crash:show`           | `{ report }`                                   | 새 오류 보고서                             |
| `crash:testThrow`      | `{ message }`                                  | 테스트 모드에서 화면이 오류를 던지게 할 때 |
| `updater:status`       | `UpdaterStatus`                                | 업데이트 상태가 바뀜                       |

## 빌드 입력 계약

설치 파일을 만드는 쪽이 넣는 값과 그 결과다. 실행 중에는 바꿀 수 없다.

| 입력                     | 형식                                     | 결과                                                                                       |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GDESK_GITHUB_CLIENT_ID` | 공개 OAuth App client ID(Device Flow 켬) | 있으면 브라우저 코드 로그인을 보인다                                                       |
| `GDESK_REPO`             | `소유자/이름`                            | 있으면 업데이트 확인·게시·오류 보고 이슈가 그 저장소를 쓴다. 형식이 틀리면 없는 것과 같다. |
| `GDESK_MAC_SIGNED`       | `1`                                      | 맥 자동 설치 업데이트. 맥 인증서 없이 주면 포장이 실패한다.                                |
| 서명 비밀값              | 인증서·암호                              | 있으면 서명(맥은 Apple 정보가 모두 있으면 공증), 없으면 서명만 건너뛰고 빌드 성공          |

게시되는 릴리스에는 OS별 설치 파일과 electron-updater가 읽는 `latest*.yml`·`.blockmap`이 함께 올라가야 한다. 설치된 앱은 게시된(초안이 아닌) 최신 릴리스만 본다.
