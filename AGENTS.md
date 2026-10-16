# Gdesk

오픈소스 메인테이너를 위한 GitHub 현황판 + 가벼운 Git(클론·열기) 데스크톱 앱. MIT, Electron + TypeScript(React), 맥·윈도우·리눅스.
사용자는 자기 컴퓨터의 한 사람, 계정은 github.com 하나, 자체 서버는 없다. 실질적인 규모 제약은 GitHub API 요청 한도다.
범용 Git 클라이언트가 아니다. 새 기능은 "메인테이너가 매일 챙길 것을 덜 놓치게 하는가"로 판단한다.

## 프로젝트 구조

```
github_desktop/
├── CLAUDE.md                         ← 이 파일(진입점)
├── AGENTS.md                         ← 이 파일과 같은 내용
├── README.md                         ← 사용자용 소개·설치·빌드 설정
├── CONTRIBUTING.md                   ← 기여자용 안내(명령, 번역, IPC 등록, 커밋 형식)
├── docs/
│   ├── architecture.md               ← 프로세스·구성 요소·의존 방향, 시작 순서, 대표 흐름, 경계
│   ├── business-rules.md             ← 업무 규칙: 세션, 동기화, 한도, 카드 계산, 클론·연결, 오류 보고
│   ├── security.md                   ← 토큰 수명, 인증 흐름과 실패 경로, 권한 표, 테스트 모드, 기록
│   ├── standards.md                  ← 검증 관문, 모듈 경계, 자동 수집 규칙, 마이그레이션·번역 규칙
│   ├── engineering-notes.md          ← 함정(화면 갱신, 초기화 순서, 테스트 모드, 패키징, 화면 테스트 격리)
│   ├── operations.md                 ← 설정·명령·환경 변수·포장·CI·릴리스 절차
│   ├── contracts.md                  ← 메인 ↔ 화면 IPC 채널 목록, 빌드 입력
│   ├── oauth-app.md                  ← OAuth App 등록 안내(사람용)
│   ├── signing.md                    ← 서명·공증 비밀값 안내(사람용)
│   └── tracking/
│       ├── status.md                 ← 기능별 완료·검증 현황과 남은 일
│       ├── findings.md               ← 풀리지 않은 문제와 못 푸는 이유
│       └── decisions/
│           ├── index.md              ← 결정 기록 목록
│           └── 0001~0009-*.md        ← 개별 결정(맥락·선택지·결과)
├── src/
│   ├── main/
│   │   └── AGENTS.md                 ← 메인 프로세스: GitHub·토큰·git·DB·동기화·IPC 처리기
│   ├── preload/
│   │   └── AGENTS.md                 ← window.gdesk(invoke·on) 통로
│   ├── renderer/
│   │   └── AGENTS.md                 ← 화면: 기능 폴더, 라우트·슬롯·번역, 데이터 갱신 규칙
│   └── shared/
│       └── AGENTS.md                 ← 공용 도메인 타입·상태 값·IPC 계약
└── tests/
    └── AGENTS.md                     ← 가짜 GitHub 서버, Playwright 화면 테스트
```

## 절대 규칙

1. **토큰은 메인 프로세스 밖으로 나가지 않는다.** 메모리(로그인 서비스)와 OS 보안 저장소(리눅스 키링이 없으면 사용자가 동의한 0600 파일)에만 둔다. IPC 응답·이벤트, 로그, 오류 문구, 오류 보고, git 인자, 원격 주소, `.git/config`, 클론 폴더 어디에도 나타나면 안 된다.
2. **통신 상대는 GitHub뿐이다.** api.github.com, github.com(기기 인증·git), GitHub Releases(업데이트) 말고는 어떤 서버와도 통신하지 않는다. 사용 통계·원격 오류 수집을 넣지 않는다. OAuth client secret은 코드·빌드·저장소 어디에도 넣지 않는다(공개 client ID는 비밀이 아니어서 기본값이 `build/client-id.ts`에 있고, `GDESK_GITHUB_CLIENT_ID`로 덮어쓴다).
3. **사용자 폴더를 지우지 않는다.** 앱이 지우는 폴더는 클론이 실패·취소됐을 때 그 클론이 새로 만든 대상 폴더 하나뿐이다(원래 있던 빈 폴더에 클론했는데 `.git/config`에 토큰이 남았으면 그 클론이 만든 `.git`만 지운다). 연결 해제·로그아웃·계정 전환은 DB 행만 바꾼다.
4. **테스트용 덮어쓰기는 테스트 빌드 + 테스트 모드에서만.** API 주소 바꾸기, 토큰 주입, 사용자 데이터 폴더 바꾸기 등은 빌드 상수 `__GDESK_TEST_BUILD__`와 실행 시 `GDESK_TEST_MODE=1`이 모두 있어야 켜진다. 화면 테스트는 가짜 GitHub 서버에만 붙는다.
5. **문구는 en·ko 함께, 검증은 모두 통과.** 사용자에게 보이는 문구는 `src/renderer/locales/{en,ko}/`에 함께 넣는다. 변경을 마치기 전에 `pnpm typecheck && pnpm lint && pnpm test`가 통과해야 하고, 화면을 바꿨다면 `pnpm test:e2e`도 통과해야 한다.

전체 규칙은 `docs/standards.md`에 있다.

## 작업 전에 읽을 것

항상: `docs/standards.md`, `docs/engineering-notes.md`, 고칠 폴더의 `AGENTS.md`.

작업 종류별:

| 하려는 일                                  | 먼저 읽을 곳                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 로그인·토큰·세션, git 인증, 오류 보고 내용 | `docs/security.md`의 토큰·인증 흐름·오류 보고 절, `src/main/AGENTS.md`의 "반드시 지킬 것"                                                             |
| 로그아웃·계정 전환에 걸리는 데이터 추가    | `docs/business-rules.md`의 세션 상태 전이 표, `docs/standards.md`의 DB 마이그레이션 절(`CACHE_TABLES`, `clearAccountData`)과 캐시 쓰기 세대 확인 규칙 |
| 캐시 테이블·마이그레이션 추가              | `docs/standards.md`의 DB 마이그레이션 절(새 ID 접두사, 배포된 마이그레이션 수정 금지, `cache_` 이름과 정리 등록)                                      |
| 새 화면·화면 요소                          | `src/renderer/AGENTS.md`(route.tsx·slots.tsx·locales, `query:`가 아닌 채널 갱신), `docs/engineering-notes.md`의 "화면 데이터가 갱신되지 않는다"       |
| 새 IPC 채널                                | `docs/contracts.md`의 공통 규칙, `src/shared/AGENTS.md`의 채널 선언 예시                                                                              |
| GitHub 요청 추가·변경                      | `docs/business-rules.md`의 자동 갱신·요청 한도 보호 절, `tests/AGENTS.md`의 가짜 서버(operationName 등록)                                             |
| 클론·로컬 연결·폴더를 건드리는 코드        | `docs/business-rules.md`의 클론·로컬 연결 절, `docs/security.md`의 폴더 절                                                                            |
| 동기화 주기·상세 추적                      | `docs/business-rules.md`의 자동 갱신 절, `docs/tracking/decisions/0002-detail-only-for-tracked-repos.md`                                              |
| 포장·서명·릴리스                           | `docs/operations.md`, `docs/engineering-notes.md`의 패키징 항목들                                                                                     |
| 무엇이 끝났고 무엇이 남았는지              | `docs/tracking/status.md`, `docs/tracking/findings.md`                                                                                                |

## 문제를 발견했을 때

다음은 **즉시 사용자에게 알린다**(조용히 고치거나 기록만 하지 않는다).

- 토큰이 메인 프로세스 밖(화면으로 가는 값, 로그, 오류 보고, 클론 폴더·`.git/config`·원격 주소, git 인자)에 나타나는 경로
- 클론이 새로 만든 폴더가 아닌 사용자 폴더·파일을 지울 수 있는 경로
- 다른 계정으로 로그인한 뒤 이전 계정의 받아온 정보·고정·로컬 연결이 보이는 경로
- 테스트용 덮어쓰기(주소 바꾸기, 토큰 주입 등)가 배포 빌드에서 켜질 수 있는 경로. 테스트 빌드(`out/`)가 설치 파일로 포장되는 경우 포함
- GitHub 이외의 호스트로 데이터가 나가는 경로

그 밖의 문제(버그, 확인되지 않은 플랫폼 동작, 비용·설계 문제)는 그 자리에서 풀 수 없으면 `docs/tracking/findings.md`에 현상·영향·못 푸는 이유·방법으로 기록한다.
