# 운영

## 준비물

| 준비물             | 버전                                                                                                            | 확인                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Node.js            | 22.13 이상(`node:sqlite`가 플래그 없이 되는 버전)                                                               | `node -v`                    |
| pnpm               | 9 (`packageManager: pnpm@9.12.0`)                                                                               | `corepack enable && pnpm -v` |
| git                | 저장소를 받는 데만 필요. 앱은 내장 git(dugite)을 쓴다.                                                          | —                            |
| 리눅스 화면 테스트 | `xvfb`. Ubuntu 24.04는 Electron 샌드박스를 위해 `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` | `xvfb-run --help`            |

## 처음 설정

```bash
git clone <저장소> gdesk && cd gdesk
pnpm install          # dugite 가 이 기계 CPU 용 git 을, electron 이 실행 파일을 내려받는다
pnpm typecheck && pnpm lint && pnpm test
pnpm dev              # 개발 실행. 로그인 화면에서 브라우저 로그인 또는 개인 토큰을 쓴다
```

- `pnpm install`은 설치 스크립트가 허용된 패키지(`dugite`, `electron`, `esbuild`)만 스크립트를 돌린다. 설치가 네트워크 문제로 중간에 끊겼으면 내장 git이 없어 클론·원격 읽기 테스트가 실패한다. `node node_modules/dugite/script/download-git.js`로 다시 받는다.
- 개발 실행에도 기본 공개 client ID가 들어가 브라우저 코드 로그인이 보인다. 다른 OAuth App을 쓰려면 `GDESK_GITHUB_CLIENT_ID=<공개 client ID> pnpm dev`, 토큰 입력만 보려면 `GDESK_GITHUB_CLIENT_ID= pnpm dev`(빈 값).
- 개발 실행은 진짜 GitHub에 붙는다. 개발용 사용자 데이터 폴더는 OS 기본 위치의 `Gdesk`다(맥 `~/Library/Application Support/Gdesk`, 윈도우 `%APPDATA%\Gdesk`, 리눅스 `~/.config/Gdesk`). 설치된 앱과 같은 폴더를 쓴다.

## 명령

| 명령                           | 하는 일                                                                                          | 앞서 필요한 것                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `pnpm dev`                     | electron-vite 개발 서버 + Electron                                                               | `pnpm install`                                                   |
| `pnpm build`                   | `out/`에 배포용 빌드                                                                             | —                                                                |
| `pnpm start`                   | 빌드 결과 미리 보기                                                                              | —                                                                |
| `pnpm typecheck`               | 두 tsconfig로 타입 검사                                                                          | —                                                                |
| `pnpm lint`                    | ESLint, 경고도 실패                                                                              | —                                                                |
| `pnpm format`                  | Prettier로 고치기                                                                                | —                                                                |
| `pnpm exec prettier --check .` | 서식 검사(CI는 리눅스에서만)                                                                     | —                                                                |
| `pnpm test`                    | Vitest 단위 테스트                                                                               | —                                                                |
| `pnpm test:e2e`                | `GDESK_TEST_BUILD=1 GDESK_GITHUB_CLIENT_ID=gdesk-e2e-client`로 `out/`에 테스트 빌드 → Playwright | 리눅스는 `xvfb-run -a pnpm test:e2e`                             |
| `pnpm dist:dir`                | 다시 빌드한 뒤 설치 파일 없이 앱 폴더만 `release/`에                                             | 저장소 안에 심볼릭 링크 `node_modules`를 쓰는 worktree가 없을 것 |
| `pnpm dist`                    | 다시 빌드한 뒤 지금 OS용 설치 파일을 `release/`에                                                | 같음                                                             |

순서 주의:

- `pnpm test:e2e` 뒤 `out/`은 테스트 빌드다. 그 상태로 `electron-builder`를 직접 부르면 테스트 빌드가 포장된다. 포장은 `pnpm dist`/`pnpm dist:dir`로만 한다(먼저 다시 빌드한다).
- 애플 실리콘에서 `pnpm dist`가 도는 동안에는 테스트·개발 실행을 하지 않는다. Intel 앱을 만드는 동안 `node_modules/dugite/git`이 x64 git으로 바뀌어 있다.
- 화면 테스트는 직렬(`workers: 1`)이고 테스트마다 앱을 새로 띄운다. CI에서는 실패 시 한 번 다시 돈다.

## 로컬에서 서명 없이 포장

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm dist:dir   # 앱 폴더만(빠름)
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm dist       # 지금 OS 용 설치 파일
```

- `CSC_LINK`·`CSC_NAME`이 없으면 맥 서명을 건너뛴다. `CSC_IDENTITY_AUTO_DISCOVERY=false`는 키체인에 인증서가 있어도 쓰지 않게 한다.
- 결과 확인: 맥은 `release/mac-arm64/Gdesk.app/Contents/Resources/app.asar.unpacked/node_modules/dugite/git/bin/git --version`이 실행되어야 한다. 포장 설정의 `afterPack`이 내장 git이 없거나 CPU가 다르면 빌드를 실패시킨다.
- 윈도우·리눅스 설치 파일은 각 OS(CI 러너)에서 만든다.

## 환경 설정

### 빌드 때 넣는 값

빌드 결과에 상수로 들어간다. 실행 중에 바꿀 수 없다.

| 이름                     | 뜻                                                            | 형식                        | 비어 있거나 틀리면                                                                                              |
| ------------------------ | ------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GDESK_GITHUB_CLIENT_ID` | GitHub OAuth App의 공개 client ID. 기기 인증에 쓴다.          | 문자열(비밀 아님)           | 없으면 기본값 `Ov23liGhQ9tQPP7wqESg`(`build/client-id.ts`). 빈 값이면 브라우저 코드 로그인을 숨기고 토큰 입력만 |
| `GDESK_REPO`             | Gdesk 저장소. 업데이트 확인, 오류 보고 이슈, 포장의 게시 대상 | `소유자/이름`(영숫자·`_.-`) | 업데이트 꺼짐(`unavailable`), 오류 보고는 복사로 대체, electron-builder 게시 설정 없음                          |
| `GDESK_MAC_SIGNED`       | `1`이면 서명된 맥 빌드로 보고 맥 자동 업데이트를 켠다         | `1` 또는 없음               | 맥은 새 버전 알림만. `1`인데 맥 인증서가 없으면 포장이 일부러 실패한다.                                         |
| `GDESK_TEST_BUILD`       | `1`이면 테스트 빌드. `pnpm test:e2e`만 쓴다.                  | `1` 또는 없음               | 배포 빌드(테스트 모드 불가)                                                                                     |

### 실행 때 읽는 값(테스트 빌드에서만 의미 있음)

| 이름                   | 뜻                                                |
| ---------------------- | ------------------------------------------------- |
| `GDESK_TEST_MODE=1`    | 테스트 모드 켜기(테스트 빌드일 때만)              |
| `GDESK_TEST_API_BASE`  | GitHub API 주소(가짜 서버 `.../api`)              |
| `GDESK_TEST_WEB_BASE`  | GitHub 웹 주소(가짜 서버 `.../web`, 기기 인증)    |
| `GDESK_TEST_GIT_BASE`  | 클론 원본 주소 앞부분(`<값>/<소유자>/<이름>.git`) |
| `GDESK_TEST_TOKEN`     | 시작할 때 이 토큰으로 자동 로그인(저장 안 함)     |
| `GDESK_TEST_USER_DATA` | 사용자 데이터 폴더                                |

배포 빌드는 위 값을 모두 무시한다.

### 포장·CI 비밀값

| 이름                                                       | 어디에                                     | 뜻                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `CSC_LINK`, `CSC_KEY_PASSWORD`                             | Actions Secrets                            | 맥 Developer ID Application 인증서(.p12 base64)와 암호. 있으면 맥 서명 + `GDESK_MAC_SIGNED=1` |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Actions Secrets                            | 셋 다 있으면 서명한 맥 앱을 공증. 하나라도 없으면 공증만 건너뜀                               |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`                     | Actions Secrets                            | 윈도우 코드 서명 인증서와 암호                                                                |
| `GDESK_GITHUB_CLIENT_ID`                                   | Actions Variables(권장) 또는 Secrets       | 릴리스 빌드의 공개 client ID를 덮어쓸 때만. 없으면 기본값이 들어간다(빈 값은 넘기지 않음)     |
| `GDESK_REPO`                                               | 워크플로가 `github.repository`로 자동 설정 | —                                                                                             |
| `GITHUB_TOKEN`                                             | 자동 제공                                  | Release 초안 만들기와 파일 올리기                                                             |

- 비밀값이 없으면 그 OS의 서명 단계만 건너뛰고 빌드는 성공한다.
- 빈 값을 electron-builder에 넘기면 서명을 시도하므로, 워크플로는 값이 있는 것만 환경 변수로 넘긴다.
- 맥 인증서가 있는데 서명이 실제로 안 되면 `forceCodeSigning` 때문에 빌드가 실패한다. 서명 안 된 앱이 자동 업데이트를 시도하는 일을 막는다.

## OAuth App 준비(다른 OAuth App을 쓸 때)

기본 client ID(Gdesk OAuth App)를 쓰면 이 절차는 필요 없다. 포크처럼 자기 OAuth App을 쓰려면 다음을 한다.

1. GitHub Settings → Developer settings → OAuth Apps → New OAuth App. GitHub App이 아니라 OAuth App이어야 알림 API를 쓸 수 있다.
2. 콜백 주소는 아무 https 주소나 넣는다(기기 인증은 쓰지 않는다).
3. 앱 설정에서 **Enable Device Flow**를 켠다. 끄면 GitHub가 `device_flow_disabled`로 거절하지만, 앱은 이 코드를 구분하지 않고 일반 오류("GitHub에서 오류가 났어요")로 보인다. client ID가 틀릴 때(`incorrect_client_credentials`)도 같은 문구다.
4. client secret은 만들지 않는다.
5. client ID를 `GDESK_GITHUB_CLIENT_ID`(빌드)와 Actions Variables에 넣어 기본값을 덮어쓴다.

## 데이터 위치와 초기화

| 무엇                  | 위치                                                             |
| --------------------- | ---------------------------------------------------------------- |
| DB                    | `<userData>/gdesk.db` (+ `-wal`, `-shm`)                         |
| 토큰                  | `<userData>/auth/credential.enc` 또는 `credential.insecure.json` |
| 리눅스 저장 방식 선택 | `<userData>/auth/storage-choice.json`                            |

- 앱 안에서 로그아웃하면 토큰과 받아온 정보가 지워진다. 고정·연결·설정은 남는다.
- 완전히 처음 상태로 돌리려면 앱을 끄고 `<userData>` 폴더를 지운다. 클론한 폴더는 그 밖에 있으므로 남는다.
- 스키마는 앱 시작 때 자동으로 마이그레이션한다. 따로 할 일은 없다.

## CI

- `.github/workflows/ci.yml`: PR과 `main` 푸시마다.
  - check(맥·윈도우·리눅스): 설치 → typecheck → lint → (리눅스만) prettier 검사 → 단위 테스트.
  - e2e(맥·리눅스): 설치 → (리눅스) AppArmor 조정·xvfb → `pnpm test:e2e`. 실패하면 Playwright 보고서와 `test-results`를 7일 보관한다.
  - installers(맥·윈도우·리눅스, `main` 푸시에서만): 비밀값 없이 `CSC_IDENTITY_AUTO_DISCOVERY=false`로 의존성 설치 → `pnpm dist:dir`. 서명 비밀값이 없어도 포장이 되는지 본다(설치 파일은 올리지 않는다).
- 같은 PR의 이전 실행은 새 푸시가 오면 취소된다.

## 릴리스

1. `package.json`의 `version`을 올려 `main`에 합친다.
2. 같은 버전의 태그를 푸시한다: `git tag v0.2.0 && git push origin v0.2.0`. 태그와 `package.json` 버전이 다르면 워크플로가 실패한다.
3. `.github/workflows/release.yml`이 초안 Release를 하나 먼저 만들고(세 OS가 같은 초안에 올리게), 맥·윈도우·리눅스에서 각각 `pnpm build` → `electron-builder --<os> --publish always`로 설치 파일과 업데이트 정보(`latest*.yml`, `.blockmap`)를 올린다.
4. 초안을 확인하고 **게시**한다. 설치된 앱의 업데이트 확인은 게시된 릴리스만 본다. 초안 상태로 두면 아무도 업데이트를 받지 못한다.

- 산출물: 맥 dmg·zip(arm64·x64, zip은 맥 자동 업데이트용), 윈도우 nsis 설치형(x64), 리눅스 AppImage·deb(x64).
- 맥 두 CPU는 애플 실리콘 러너 하나에서 만든다. Intel용 내장 git은 포장 설정이 바꿔 넣는다.
- 수동 실행(`workflow_dispatch`)은 게시하지 않고 설치 파일을 작업 결과물로만 7일 보관한다.

## 사용자 쪽 안내

- 서명 안 된 맥 앱을 처음 열 때 경고가 뜨면 응용 프로그램 폴더로 옮긴 뒤 `xattr -cr /Applications/Gdesk.app`.
- 서명 안 된 윈도우 설치 파일은 SmartScreen 경고에서 "추가 정보 → 실행".
- 리눅스 deb는 제자리 업데이트를 하지 않는다. 새 버전 알림에서 다운로드 페이지를 연다.
- 조직 저장소가 안 보이면 그 조직이 OAuth App 접근을 제한한 것이다. 조직 관리자가 Gdesk를 승인해야 한다.

## 앱 아이콘

- 원본은 `build/icon.svg`(1024×1024, 둥근 사각형 바깥은 투명)이고, electron-builder는 같은 폴더의 `build/icon.png`를 읽어 맥·윈도우·리눅스 아이콘을 만든다.
- 아이콘을 바꾸면 SVG를 고친 뒤 1024×1024 PNG로 다시 내보내 `build/icon.png`를 교체한다. 모서리가 투명하지 않으면 맥 Dock에서 흰 테두리가 보인다.
- `pnpm dist:dir` 로그에 "default Electron icon is used"가 나오면 `build/icon.png`를 찾지 못한 것이다.
