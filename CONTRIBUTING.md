# Gdesk 에 기여하기

관심 가져 주셔서 고맙습니다. 이슈와 PR 은 한국어·영어 모두 환영합니다.
_Issues and pull requests are welcome in Korean or English._

## 시작하기

Node.js 22.13 이상과 pnpm 9 가 필요합니다.

```bash
pnpm install
pnpm dev
```

기본 OAuth client ID 가 코드에 들어 있어 따로 설정하지 않아도 브라우저 로그인과 개인 토큰 입력을 모두 쓸 수 있습니다.
다른 OAuth App 을 쓰려면 `GDESK_GITHUB_CLIENT_ID=<client ID> pnpm dev`, 토큰 입력만 보려면 `GDESK_GITHUB_CLIENT_ID= pnpm dev`(빈 값)로 실행합니다.
자기 OAuth App 을 등록하는 방법은 [docs/oauth-app.md](docs/oauth-app.md) 를 봅니다.

## PR 전에 확인할 명령

아래 명령이 **모두 통과**해야 합니다. CI 는 타입 검사·코드 규칙·단위 테스트를 맥·윈도우·리눅스에서,
서식 검사는 리눅스에서만(줄바꿈 차이 회피), 화면 자동 테스트는 맥·리눅스에서 돌립니다.

```bash
pnpm typecheck                 # 타입 검사(메인·화면)
pnpm lint                      # 코드 규칙(경고도 실패)
pnpm test                      # 단위 테스트(vitest)
pnpm exec prettier --check .   # 서식(작은따옴표, 세미콜론 없음, 한 줄 100자)
pnpm test:e2e                  # 화면 자동 테스트(가짜 GitHub 서버, 실제 GitHub 에 접속하지 않음)
```

서식은 `pnpm format` 으로 고칩니다. 설치 파일까지 확인하려면 `pnpm dist:dir` 를 씁니다.

## 지켜야 할 규칙

### 모든 화면 문구는 영어·한국어 둘 다

- 사용자에게 보이는 문구는 코드에 직접 쓰지 않고 번역 파일에 둡니다.
- 기능마다 자기 네임스페이스 파일을 **두 언어 모두** 만듭니다:
  `src/renderer/locales/en/<기능>.json`, `src/renderer/locales/ko/<기능>.json`.
- 두 파일의 키 집합이 같아야 합니다. `tests/unit/locales.test.ts` 가 검사합니다.
- 한국어는 번역투 없이 자연스럽게 씁니다.

### 메인 ↔ 화면 통신(IPC)

화면(렌더러)은 격리되어 있어 Node·Electron 기능을 직접 쓰지 않습니다. GitHub API, git, DB 는 메인
프로세스에서만 다룹니다.

1. **채널 선언**: `src/shared/ipc/<기능>.ts` 에서 `./contract` 의 인터페이스를 선언 병합으로 넓힙니다.
   채널 이름은 `<기능>:<동작>` 입니다(예: `updater:check`). 예시는 `src/shared/ipc/app.ts`.

   ```ts
   declare module './contract' {
     interface IpcInvokeChannels {
       'pins:list': { req: void; res: Pin[] }
     }
     interface IpcEventChannels {
       'pins:changed': { pins: Pin[] }
     }
   }
   export {}
   ```

2. **처리기**: `src/main/<기능>/<기능>.ipc.ts` 에서 `export function registerIpc()` 를 내보내고, 안에서
   `src/main/ipc/registry.ts` 의 `handle()` 로 등록하고 `emit()` 으로 이벤트를 보냅니다. 자동으로 모입니다.
3. **화면에서 호출**: `src/renderer/lib/ipc.ts` 의 `useIpcQuery`(조회), `invoke`(동작), `useIpcEvent`(이벤트)를 씁니다.
4. 공용 계약 파일(`contract.ts`), 등록기(`registry.ts`), 프리로드, `src/main/index.ts` 는 기능 PR 에서 고치지 않습니다.
   서비스 초기화가 필요하면 PR 설명에 "index.ts 에 무엇을 어디에 추가해야 하는지" 적어 주세요.

### 화면 라우트와 슬롯

- **라우트**: `src/renderer/features/<기능>/route.tsx` 에서 `export const routes: RouteObject[]` 를 내보내면
  자동으로 등록됩니다. 예시는 `features/home/route.tsx`.
- **슬롯**: 사이드바·배너·상단 동작·오버레이 등은 `src/renderer/features/<기능>/slots.tsx` 에서
  `export const slots: FeatureSlots` 로 내보냅니다(`src/renderer/app/slots.ts` 참고).
  예: `banners: [{ order: 100, Component: UpdaterBanner }]`. 앱 틀 파일은 고치지 않습니다.
- 공용 부품은 `@renderer/components`(Banner, Button 등)에서 가져다 씁니다.
- 슬롯·라우트 모듈은 앱 시작 때 바로 읽히므로, 모듈 최상위에서 `window.gdesk` 를 부르지 않습니다.

### DB 마이그레이션

`src/main/<기능>/<이름>.migration.ts` 에서 `export const migration` 을 내보내면 자동으로 모입니다.

### 빌드 상수

빌드 때 들어가는 값은 `electron.vite.config.mts` 의 `__GDESK_*__` 상수로 정의하고 `src/env.d.ts` 에 타입을
적습니다. 메인 코드에서는 `src/main/config.ts` 를 거쳐 씁니다. **비밀 키는 절대 넣지 않습니다.**

### 불변 조건

- GitHub 이외의 서버와 통신하지 않습니다(업데이트 확인도 GitHub Releases). 사용 통계를 넣지 않습니다.
- 로그인 토큰은 화면 코드, 로그, 오류 보고, 클론 폴더 어디에도 나오면 안 됩니다.
- 외부 링크는 `https:`·`http:` 만 기본 브라우저로 엽니다.

## 커밋 메시지

[Conventional Commits](https://www.conventionalcommits.org/) 형식을 따르고, 설명은 한국어로 짧게 씁니다.

```
<종류>(<범위>): <무엇을 했는지>
```

- 종류: `feat` 기능, `fix` 버그 수정, `test` 테스트, `docs` 문서, `refactor`, `chore` 설정·의존성, `ci`
- 범위: 기능 폴더 이름(예: `updater`, `git`, `github`, `db`, `renderer`)
- 예: `feat(updater): 서명 안 된 맥은 새 버전 알림만 띄움`, `fix(git): 클론 취소 시 만든 폴더 정리`
- 한 커밋에는 한 가지 변경만 담습니다.

## 릴리스(메인테이너)

1. `package.json` 의 `version` 을 올려 main 에 합칩니다.
2. `git tag v<버전> && git push origin v<버전>`
3. Release 워크플로가 만든 **초안**을 확인하고 게시합니다.

서명 비밀값은 [docs/signing.md](docs/signing.md) 를 봅니다.
