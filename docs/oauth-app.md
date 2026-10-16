# GitHub OAuth App 등록 (브라우저 코드 로그인)

Gdesk 의 "브라우저로 로그인"은 GitHub OAuth **기기 인증(Device Flow)** 을 쓴다. `gh` 명령줄 도구와 같은 방식이다.
앱이 코드를 보여 주고, 사용자가 브라우저에서 그 코드를 입력해 승인한다.

- 필요한 값은 **공개 client ID 하나**뿐이다. **client secret 은 만들지도, 넣지도 않는다.**
  MIT 로 공개되는 코드와 배포 파일에는 비밀 값을 숨길 수 없기 때문이다.
- Gdesk OAuth App 의 client ID(`Ov23liGhQ9tQPP7wqESg`)가 **기본값으로 코드에 들어 있다**.
  `GDESK_GITHUB_CLIENT_ID` 환경 변수를 주면 그 값이 기본값을 덮어쓴다.
- `GDESK_GITHUB_CLIENT_ID=`(빈 값)으로 빌드하면 브라우저 로그인을 숨기고 **개인 토큰 직접 입력**만 제공한다.
  앱은 그대로 동작한다.

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

Gdesk OAuth App 의 client ID 는 `build/client-id.ts` 에 기본값으로 들어 있어서, 아무것도 넣지 않고
빌드해도 브라우저 로그인이 켜진다. 다른 OAuth App 을 쓰려면 **빌드할 때** `GDESK_GITHUB_CLIENT_ID`
환경 변수로 덮어쓴다.

| `GDESK_GITHUB_CLIENT_ID` | 빌드에 들어가는 client ID                  |
| ------------------------ | ------------------------------------------ |
| 없음                     | 기본값 `Ov23liGhQ9tQPP7wqESg`              |
| 값이 있음                | 그 값                                      |
| 빈 값(`=`)               | 없음. 브라우저 로그인을 숨기고 토큰 입력만 |

### 로컬 빌드

```bash
pnpm dev                                                 # 기본 client ID 로 개발 실행
GDESK_GITHUB_CLIENT_ID=Ov23liXXXXXXXXXXXXXX pnpm dist    # 다른 OAuth App 으로 설치 파일
GDESK_GITHUB_CLIENT_ID= pnpm dev                         # 브라우저 로그인 끄고 실행
```

`electron.vite.config.mts` 가 `build/client-id.ts` 의 `resolveClientId` 로 값을 정해
`__GDESK_GITHUB_CLIENT_ID__` 상수로 넣고, 메인 프로세스는 `src/main/config.ts` 의 `GITHUB_CLIENT_ID` 로 읽는다.
화면 테스트 빌드(`pnpm test:e2e`)는 가짜 서버용 `gdesk-e2e-client` 를 따로 넣는다.

### CI(릴리스 워크플로)

아무것도 만들지 않으면 릴리스 빌드에 기본 client ID 가 들어간다. 다른 OAuth App 을 쓰려면 저장소의
**Settings → Secrets and variables → Actions** 에서 다음 중 하나를 만든다.

- **Variables** 탭 → `GDESK_GITHUB_CLIENT_ID` (권장: 비밀이 아니므로 변수로 둔다)
- 또는 **Secrets** 탭 → `GDESK_GITHUB_CLIENT_ID`

`.github/workflows/release.yml` 의 "Configure OAuth client ID" 단계가 변수를 먼저, 없으면 비밀값을 읽어
값이 있을 때만 `GDESK_GITHUB_CLIENT_ID` 를 설정한다. 둘 다 없으면 환경 변수를 아예 설정하지 않으므로
빈 값 때문에 브라우저 로그인이 꺼진 채로 배포되는 일은 없다.

## 포크해서 따로 배포할 때

포크에서 아무것도 넣지 않고 빌드하면 **원본 Gdesk 의 client ID 가 그대로 들어간다**. 승인 화면에 원본
Gdesk 의 앱 이름과 소유자가 보이므로, 포크에서 자기 설치 파일을 배포하려면 다음 중 하나를 한다.

- **자기 OAuth App 을 따로 등록**하고 그 client ID 를 `GDESK_GITHUB_CLIENT_ID` 로 넣는다
  (CI 에서는 위의 Actions 변수).
- 브라우저 로그인 없이 배포하려면 `GDESK_GITHUB_CLIENT_ID=`(빈 값)으로 빌드한다. 릴리스 워크플로는 빈 값을
  넘기지 않으므로, CI 에서 끄려면 워크플로의 "Build app" 단계에 빈 값을 직접 적는다.

## 문제 해결

| 증상                                    | 확인할 것                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| 로그인 화면에 브라우저 로그인이 없음    | 빌드할 때 `GDESK_GITHUB_CLIENT_ID` 를 빈 값으로 넣었다                           |
| 브라우저 로그인이 일반 오류로 바로 실패 | **Enable Device Flow** 가 켜져 있는지, client ID 오타·지워진 OAuth App 이 아닌지 |
| 조직 저장소가 안 보임                   | 조직이 OAuth App 접근을 제한함 → 조직 관리자가 Gdesk 를 승인해야 함              |

브라우저 로그인 시작이 실패하면 앱은 GitHub 의 오류 코드(`device_flow_disabled`, `incorrect_client_credentials`
등)를 구분하지 않고 "GitHub에서 오류가 났어요"(영어 화면 "GitHub returned an error") 하나로 보인다.
