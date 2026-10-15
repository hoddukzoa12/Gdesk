# 코드 서명과 공증

Gdesk 설치 파일은 **서명용 비밀값이 있을 때만** 서명·공증한다. 비밀값이 없으면 서명 단계만 건너뛰고
빌드는 그대로 성공한다. 그래서 포크나 인증서가 없는 저장소에서도 릴리스 워크플로가 동작한다.

비밀값은 저장소의 **Settings → Secrets and variables → Actions → Secrets** 에 넣는다.
`.github/workflows/release.yml` 이 값이 있는 것만 해당 OS 작업의 환경 변수로 넘긴다.

## macOS

| 비밀값 이름                   | 내용                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `CSC_LINK`                    | **Developer ID Application** 인증서와 개인 키를 내보낸 `.p12` 파일을 base64 로 바꾼 값(`base64 -i cert.p12`). |
| `CSC_KEY_PASSWORD`            | 그 `.p12` 파일의 암호                                                                                         |
| `APPLE_ID`                    | 공증에 쓸 Apple 계정 이메일                                                                                   |
| `APPLE_APP_SPECIFIC_PASSWORD` | 그 계정의 앱 전용 암호([appleid.apple.com](https://appleid.apple.com) → 로그인 및 보안 → 앱 암호)             |
| `APPLE_TEAM_ID`               | Apple Developer 팀 ID(10자리)                                                                                 |

- `CSC_LINK` 가 있으면 앱을 서명하고(hardened runtime + `build/entitlements.mac.plist`), 빌드에
  `GDESK_MAC_SIGNED=1` 을 넣는다. 이 빌드는 **자동 업데이트**(뒤에서 내려받고 재시작 때 적용)를 쓴다.
- `APPLE_ID`·`APPLE_APP_SPECIFIC_PASSWORD`·`APPLE_TEAM_ID` 가 **모두** 있으면 서명한 앱을 Apple 에 공증한다.
  하나라도 없으면 공증만 건너뛴다(서명은 함). 공증하지 않은 앱은 처음 열 때 Gatekeeper 경고가 뜬다.
- 인증서 없이 공증 정보만 있으면 아무것도 하지 않는다(공증은 서명된 앱에만 가능).

### 비밀값이 없을 때(서명 안 된 맥 빌드)

- 서명을 건너뛴다(`identity: null`, CI 는 `CSC_IDENTITY_AUTO_DISCOVERY=false` 도 넣는다). 빌드는 성공한다.
- 자동 설치는 하지 않는다. 서명 안 된 앱은 macOS 업데이트 장치(Squirrel.Mac)가 설치를 거부하기 때문이다.
  대신 새 버전이 있으면 **"새 버전 있음" 알림**을 띄우고, 버튼을 누르면 GitHub Releases 다운로드 페이지를 연다.
- 사용자는 처음 열 때 경고를 볼 수 있다. 앱을 응용 프로그램 폴더로 옮긴 뒤
  `xattr -cr /Applications/Gdesk.app` 을 실행하면 열린다.

## Windows

| 비밀값 이름            | 내용                                                  |
| ---------------------- | ----------------------------------------------------- |
| `WIN_CSC_LINK`         | 코드 서명 인증서 `.pfx`(또는 `.p12`) 파일의 base64 값 |
| `WIN_CSC_KEY_PASSWORD` | 그 인증서 파일의 암호                                 |

- 값이 있으면 electron-builder 가 설치 파일과 실행 파일을 서명한다.
- 없으면 서명을 건너뛰고 빌드는 성공한다. 설치할 때 SmartScreen 경고("Windows의 PC 보호")가 뜰 수 있다.
- **자동 업데이트는 서명 여부와 관계없이 동작한다**(뒤에서 내려받고 재시작 때 적용).

## Linux

서명하지 않는다.

- **AppImage**: 자동 업데이트(뒤에서 내려받고 재시작 때 적용).
- **deb**: 제자리 업데이트를 하지 않는다. 새 버전 알림을 띄우고 다운로드 페이지를 연다.

## 그 밖의 값

| 이름                     | 종류           | 내용                                                                           |
| ------------------------ | -------------- | ------------------------------------------------------------------------------ |
| `GITHUB_TOKEN`           | 자동 제공      | Release 초안 만들기와 파일 올리기. 워크플로에 `contents: write` 권한이 있다.   |
| `GDESK_GITHUB_CLIENT_ID` | 변수 또는 비밀 | OAuth App 공개 client ID. [oauth-app.md](oauth-app.md) 참고                    |
| `GDESK_REPO`             | 자동           | 워크플로가 `${{ github.repository }}` 로 넣는다. 앱이 업데이트를 확인할 저장소 |

## 업데이트 방식 요약

| 빌드                       | 업데이트 방식                                 |
| -------------------------- | --------------------------------------------- |
| Windows (서명 여부 무관)   | 뒤에서 내려받고 재시작 때 적용, 준비되면 알림 |
| Linux AppImage             | 뒤에서 내려받고 재시작 때 적용, 준비되면 알림 |
| macOS, 서명됨              | 뒤에서 내려받고 재시작 때 적용, 준비되면 알림 |
| macOS, 서명 안 됨          | 새 버전 알림 → 다운로드 페이지 열기           |
| Linux deb                  | 새 버전 알림 → 다운로드 페이지 열기           |
| 개발 실행·화면 테스트 모드 | 꺼짐(`disabled`)                              |
| `GDESK_REPO` 없이 빌드     | 확인 안 함(`unavailable`)                     |

업데이트 확인은 GitHub Releases(`https://github.com/<GDESK_REPO>/releases`)에만 접속한다. 다른 서버는 쓰지 않는다.

## 로컬에서 서명 없이 빌드하기

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm dist        # 지금 OS 용 설치 파일
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm dist:dir    # 앱 폴더만(빠름)
```

로컬에서 서명하려면 `CSC_LINK`(또는 키체인의 인증서 이름 `CSC_NAME`)와 `CSC_KEY_PASSWORD` 를 넣고,
자동 업데이트를 쓰려면 `GDESK_MAC_SIGNED=1` 도 함께 넣는다.

- 서명할 때는 `CSC_IDENTITY_AUTO_DISCOVERY=false` 를 **같이 넣지 않는다**(`CSC_NAME` 을 함께 줄 때만 괜찮다).
  이 값이 false 이면 electron-builder 가 `CSC_LINK` 로 가져온 인증서를 찾지 않는다.
- 인증서를 넣었는데 서명이 실제로 안 되면 `forceCodeSigning` 때문에 빌드가 실패한다(조용히 서명 없는 앱이 나가지 않게).
- `GDESK_MAC_SIGNED=1` 인데 인증서가 없으면 빌드 설정이 일부러 실패시킨다(서명 안 된 앱이 자동 설치를 시도하지 않게).

## 내장 git 과 CPU

클론에 쓰는 내장 git(dugite)은 asar 밖(`app.asar.unpacked/node_modules/dugite/git`)에 들어간다.
dugite 는 설치한 기계의 CPU 용 git 만 받아 두므로, 애플 실리콘 기계에서 Intel(x64) 맥 앱을 만들 때는
`electron-builder.ts` 의 `beforePack` 이 x64 용 git 으로 바꿔 넣고 끝나면 되돌린다. `afterPack` 은 패키지에
맞는 CPU 의 git 이 들어갔는지 검사하고, 아니면 빌드를 실패시킨다.
