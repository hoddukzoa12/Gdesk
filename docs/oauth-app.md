# GitHub OAuth App 등록 (브라우저 코드 로그인)

Gdesk 의 "브라우저로 로그인"은 GitHub OAuth **기기 인증(Device Flow)** 을 쓴다. `gh` 명령줄 도구와 같은 방식이다.
앱이 코드를 보여 주고, 사용자가 브라우저에서 그 코드를 입력해 승인한다.

- 필요한 값은 **공개 client ID 하나**뿐이다. **client secret 은 만들지도, 넣지도 않는다.**
  MIT 로 공개되는 코드와 배포 파일에는 비밀 값을 숨길 수 없기 때문이다.
- client ID 가 없는 빌드에서는 브라우저 로그인을 숨기고 **개인 토큰 직접 입력**만 제공한다. 앱은 그대로 동작한다.

## 1. OAuth App 만들기

1. GitHub 에서 **Settings → Developer settings → OAuth Apps → New OAuth App** 으로 간다.
   조직 소유로 만들려면 조직의 **Settings → Developer settings → OAuth Apps** 에서 만든다.
2. 다음처럼 채운다.

   | 항목                       | 값                                                                      |
   | -------------------------- | ----------------------------------------------------------------------- |
   | Application name           | `Gdesk` (사용자가 승인 화면에서 보는 이름)                              |
   | Homepage URL               | Gdesk 저장소 주소(예: `https://github.com/<소유자>/gdesk`)              |
   | Application description    | 선택                                                                    |
   | Authorization callback URL | 아무 https 주소나 넣는다(예: Homepage URL). Device Flow 는 쓰지 않는다. |

3. **Register application** 을 누른다.

> **GitHub App 이 아니라 OAuth App** 이다. Gdesk 는 사용자 토큰으로 `repo`, `read:org`, `notifications`
> 권한을 요청하는데, 알림(notifications) API 는 OAuth App 토큰(또는 classic 개인 토큰)만 접근할 수 있다.

## 2. Device Flow 켜기

만든 앱의 설정 페이지에서 **Enable Device Flow** 를 체크하고 저장한다. 이것을 켜지 않으면 GitHub 가
기기 인증 요청을 거절하고, 앱은 "GitHub에서 오류가 났어요"(영어 화면 "GitHub returned an error") 같은
일반 오류만 보인다. GitHub 의 오류 코드(`device_flow_disabled`)는 화면에 따로 나오지 않는다.

## 3. client ID 확인

앱 설정 페이지 위쪽의 **Client ID**(예: `Ov23li...` 또는 `Iv1.`로 시작)를 복사한다.

- **Generate a new client secret** 은 누르지 않는다. 이미 만들었다면 지워도 된다.
- client ID 는 비밀이 아니다. 배포된 앱 안에서 누구나 볼 수 있다.

## 4. 빌드에 넣기

client ID 는 **빌드할 때** `GDESK_GITHUB_CLIENT_ID` 환경 변수로 넣는다. 코드에 직접 적지 않는다.

### 로컬 빌드

```bash
GDESK_GITHUB_CLIENT_ID=Ov23liXXXXXXXXXXXXXX pnpm dev     # 개발 실행
GDESK_GITHUB_CLIENT_ID=Ov23liXXXXXXXXXXXXXX pnpm dist    # 설치 파일
```

`electron.vite.config.mts` 가 이 값을 `__GDESK_GITHUB_CLIENT_ID__` 상수로 넣고, 메인 프로세스는
`src/main/config.ts` 의 `GITHUB_CLIENT_ID` 로 읽는다.

### CI(릴리스 워크플로)

저장소의 **Settings → Secrets and variables → Actions** 에서 다음 중 하나를 만든다.

- **Variables** 탭 → `GDESK_GITHUB_CLIENT_ID` (권장: 비밀이 아니므로 변수로 둔다)
- 또는 **Secrets** 탭 → `GDESK_GITHUB_CLIENT_ID`

`.github/workflows/release.yml` 은 변수를 먼저, 없으면 비밀값을 쓴다.

```yaml
GDESK_GITHUB_CLIENT_ID: ${{ vars.GDESK_GITHUB_CLIENT_ID || secrets.GDESK_GITHUB_CLIENT_ID }}
```

## 포크해서 따로 배포할 때

포크에서 자기 설치 파일을 배포하려면 **자기 OAuth App 을 따로 등록**하고 그 client ID 를 넣는다.
승인 화면에 앱 이름과 소유자가 보이므로 원본 Gdesk 의 client ID 를 그대로 쓰지 않는다.

## 문제 해결

| 증상                                    | 확인할 것                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| 로그인 화면에 브라우저 로그인이 없음    | 빌드할 때 `GDESK_GITHUB_CLIENT_ID` 가 비어 있었다                                |
| 브라우저 로그인이 일반 오류로 바로 실패 | **Enable Device Flow** 가 켜져 있는지, client ID 오타·지워진 OAuth App 이 아닌지 |
| 조직 저장소가 안 보임                   | 조직이 OAuth App 접근을 제한함 → 조직 관리자가 Gdesk 를 승인해야 함              |

브라우저 로그인 시작이 실패하면 앱은 GitHub 의 오류 코드(`device_flow_disabled`, `incorrect_client_credentials`
등)를 구분하지 않고 "GitHub에서 오류가 났어요"(영어 화면 "GitHub returned an error") 하나로 보인다.
