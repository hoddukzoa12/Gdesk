# Gdesk

오픈소스 메인테이너를 위한 GitHub 현황판 데스크톱 앱. 여러 저장소의 PR·이슈·리뷰 요청·CI·릴리스·스타·알림을
한 화면에서 보고, 저장소를 클론해 에디터로 바로 연다. 맥·윈도우·리눅스 지원, MIT 라이선스.

> **English summary** — Gdesk is a desktop GitHub dashboard for open-source maintainers. See pull
> requests, issues, review requests, CI, releases, stars and notifications across all your
> repositories in one window, then clone a repository and open it in your editor. Runs on macOS,
> Windows and Linux. It talks to no server other than GitHub and collects no usage data. MIT licensed.

<!-- 스크린샷 자리: docs/screenshot.png 를 추가하면 아래 줄의 주석을 푼다 -->
<!-- ![Gdesk 스크린샷](docs/screenshot.png) -->

_스크린샷 준비 중 / Screenshot coming soon._

## 주요 기능

- **Home**: 리뷰 요청, 읽지 않은 알림, 실패한 CI, 응답 없는 새 기여, 스타 변화 카드(순서·표시는 설정에서 바꿈)
- **Inbox**: GitHub 알림 읽음·완료 처리
- **Pull requests · Review requests · Issues · Starred · Repositories**, 저장소 상세
- 저장소 고정(Pin), 클론(HTTPS·SSH), 에디터·터미널·파일 탐색기로 열기
- 빠른 검색창(⌘K / Ctrl+K), 오프라인에서도 마지막 정보 표시
- 영어·한국어 UI, 다크·라이트 테마
- 자동 업데이트(GitHub Releases)

## 설치 / Install

[Releases](../../releases) 에서 OS 에 맞는 파일을 받는다.

| OS      | 파일                                                               | 업데이트                                    |
| ------- | ------------------------------------------------------------------ | ------------------------------------------- |
| macOS   | `Gdesk-<버전>-mac-arm64.dmg`(Apple Silicon), `-mac-x64.dmg`(Intel) | 서명된 빌드: 자동 / 서명 안 된 빌드: 알림만 |
| Windows | `Gdesk-<버전>-win-x64-setup.exe`                                   | 자동                                        |
| Linux   | `Gdesk-<버전>-linux-x86_64.AppImage`                               | 자동                                        |
| Linux   | `Gdesk-<버전>-linux-amd64.deb`                                     | 알림만(새 버전을 직접 설치)                 |

- 자동 업데이트는 새 버전을 뒤에서 내려받고 **다음 재시작 때** 적용한다. 준비되면 "지금 다시 시작" 알림이 뜬다.
- "알림만"인 빌드는 새 버전이 나오면 알림을 띄우고, 버튼을 누르면 다운로드 페이지를 연다.
- **서명 안 된 맥 빌드**를 처음 열 때 "손상되었거나 확인되지 않은 개발자" 경고가 뜨면, 앱을 응용 프로그램
  폴더로 옮긴 뒤 터미널에서 `xattr -cr /Applications/Gdesk.app` 을 실행한다.
- **서명 안 된 윈도우 설치 파일**은 SmartScreen 경고가 뜰 수 있다. "추가 정보 → 실행"을 누른다.

자세한 서명 방식은 [docs/signing.md](docs/signing.md) 를 본다.

## 개발 / Development

Node.js 22.13 이상과 pnpm 9 가 필요하다.

```bash
pnpm install
pnpm dev          # 개발 모드 실행
pnpm typecheck    # 타입 검사
pnpm lint         # 코드 규칙 검사
pnpm test         # 단위 테스트
pnpm test:e2e     # 화면 자동 테스트 (가짜 GitHub 서버 사용)
pnpm dist:dir     # 설치 파일 없이 앱 폴더만 빠르게 만들기 (release/)
pnpm dist         # 지금 OS 용 설치 파일 만들기 (release/)
```

로컬 빌드는 `CSC_LINK`(또는 `CSC_NAME`)를 넣지 않으면 서명하지 않는다. 키체인에 인증서가 있어도 쓰지 않는다.
서명하는 방법은 [docs/signing.md](docs/signing.md) 를 본다.

## 빌드 설정 / Build configuration

모두 **빌드할 때** 환경 변수로 넣는다. 비밀 키(client secret)는 어디에도 넣지 않는다.
OAuth 공개 client ID 는 비밀이 아니어서 기본값이 코드에 들어 있고, 환경 변수가 있으면 그 값이 덮어쓴다.

| 환경 변수                | 뜻                                                                                      | 비어 있으면                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GDESK_GITHUB_CLIENT_ID` | GitHub OAuth App 의 공개 client ID. 브라우저 코드 로그인(Device Flow)에 쓴다.           | 없으면 기본값(Gdesk OAuth App). 빈 값이면 브라우저 로그인을 숨기고 토큰 입력만 제공     |
| `GDESK_REPO`             | Gdesk 저장소 `소유자/이름`. 업데이트 확인과 오류 보고 이슈에 쓴다.                      | 업데이트 확인 안 함(`unavailable`). 오류 보고의 "보내기"는 이슈 열기 대신 클립보드 복사 |
| `GDESK_MAC_SIGNED`       | `1` 이면 서명된 맥 빌드로 보고 자동 업데이트를 켠다. CI 가 인증서가 있을 때만 설정한다. | 맥은 "새 버전 있음" 알림만                                                              |

```bash
GDESK_REPO=owner/gdesk pnpm dist                                        # 기본 client ID
GDESK_GITHUB_CLIENT_ID=Ov23lixxxxxxxx GDESK_REPO=owner/gdesk pnpm dist  # 다른 OAuth App
```

- OAuth App 등록 방법: [docs/oauth-app.md](docs/oauth-app.md)
- 서명·공증 비밀값: [docs/signing.md](docs/signing.md)
- 기여 방법: [CONTRIBUTING.md](CONTRIBUTING.md)

## 릴리스 / Release

`package.json` 의 `version` 을 올리고 같은 이름의 태그를 푸시한다.

```bash
git tag v0.2.0 && git push origin v0.2.0
```

GitHub Actions 가 맥·윈도우·리눅스 설치 파일을 만들어 **Release 초안**에 올린다. 초안을 확인하고 게시하면
설치된 앱이 새 버전을 찾는다.

## 개인정보 / Privacy

Gdesk 는 GitHub 이외의 서버와 통신하지 않는다. 업데이트 확인도 GitHub Releases 만 쓴다. 사용 통계는 수집하지 않는다.

## 라이선스 / License

MIT © hoddukzoa
