# src/shared — 메인과 화면의 공용 계약

## 맡는 것

- `domain/`: 화면과 메인이 함께 쓰는 도메인 타입, 상태 값 집합(`CI_STATUSES`, `CONNECTION_STATUSES` 등), 작고 순수한 판정 함수(`resolveConnectionStatus`, `resolveHomeCards`, `parseRefreshScope`, `normalizeSearchText`, `crashReportText`).
- `ipc/`: 메인 ↔ 화면 채널 계약. `contract.ts`의 빈 인터페이스(`IpcInvokeChannels`, `IpcEventChannels`)를 기능 파일이 선언 병합으로 넓힌다.

## 맡지 않는 것

- 실행 코드의 대부분. 업무 계산(CI 매핑, 응답 없는 새 기여, 스타 창 계산)은 메인의 `domain/`에 있다. 여기에는 양쪽이 모두 불러야 하는 작은 판정만 둔다.
- `src/main`, `src/renderer`, `src/preload` import. 이 폴더는 어느 쪽에도 의존하지 않는다.
- Node API(`fs`, `node:*`, `Buffer`, `process`)와 DOM API. 이 폴더는 `tsconfig.node.json`(DOM 없음)과 `tsconfig.web.json`(Node 타입 없음) 양쪽에 들어가므로 한쪽 전용 API를 쓰면 다른 쪽 typecheck가 실패한다.

## 반드시 지킬 것

- 화면으로 가는 타입(`SessionSnapshot`, `AuthResult`, `ActionResult`, `CloneOutcome`, `GitHubSearchResult`, `CrashReport` …)에 토큰을 담을 자리를 만들지 않는다. 원문 오류 객체도 담지 않는다. 화면이 번역할 실패는 문자열 리터럴 유니온 코드로 정의한다.
- 상태 값 집합은 여기 한 곳에만 정의한다: CI `passing`·`failing`·`pending`·`none`, 리뷰 `approved`·`changes_requested`·`review_required`·`none`, PR `open`·`draft`, 알림 `unread`·`read`, 로컬 연결 `ok`·`missing`, 저장소 `available`·`unavailable`, 연결 `online`·`offline`·`rate_limited`·`session_expired`.
- 연결 상태 우선순위는 `resolveConnectionStatus`의 `session_expired` > `offline` > `rate_limited` > `online`이다. 쓰기 막힘 이유의 우선순위(`session_expired` > `signed_out` > `offline` > `rate_limited`)는 메인 쓰기 서비스가 정한다.
- Home 카드 ID와 기본 순서는 `HOME_CARD_IDS`(`reviewRequests`, `unreadNotifications`, `failedCi`, `unanswered`, `starChanges`)다. 저장된 설정의 카드 ID는 이것과 다를 수 있으므로 `resolveHomeCards`로 풀어 쓴다(모르는 ID 버림, 중복은 처음 것, 빠진 카드는 켠 채로 끝에).
- 저장소 식별자는 GitHub 숫자 저장소 ID(`number`)다. 고정·연결 타입에 이름 필드를 식별자로 더하지 않는다.
- 시각 필드는 숫자면 epoch ms, 문자열이면 GitHub가 준 ISO 8601이다. 두 형식을 한 필드에 섞지 않는다.

## 구현 방식

새 IPC 기능은 `ipc/<기능>.ts`를 만든다.

```ts
import type { Foo } from '../domain/foo'

declare module './contract' {
  interface IpcInvokeChannels {
    'foo:list': { req: void; res: Foo[] }
    'foo:update': { req: { id: number }; res: Foo }
  }
  interface IpcEventChannels {
    'foo:changed': { items: Foo[] }
  }
}

export {}
```

- 채널 이름은 `<기능>:<동작>`. 캐시만 읽는 화면 조회는 `query:<이름>`으로 시작해야 `data:changed` 때 화면이 자동으로 다시 읽는다.
- 요청이 없으면 `req: void`(화면은 인자 없이 부른다).
- 끝의 `export {}`가 없으면 파일이 모듈이 아니어서 선언 병합이 되지 않는다.
- 메인 처리기와 화면은 이 파일을 side-effect import(`import '@shared/ipc/foo'`)해야 채널 타입이 보인다.
- `contract.ts` 자체는 고치지 않는다.
- 도메인 타입은 개념별 파일(`domain/<개념>.ts`)로 나눈다. 한 파일에 여러 기능의 타입을 모으지 않는다.

## 테스트

- 순수 함수는 옆에 `*.test.ts`(node 환경)를 둔다. 지금 `connection.test.ts`(우선순위 모든 조합), `homeCards.test.ts`(빈 목록, 모르는 ID, 중복, 빠진 카드, 순서 유지)가 있다.
- 값 집합에 값을 더하거나 빼면 그 값을 쓰는 화면 번역 키와 메인 매핑 테스트를 함께 바꾼다. 화면의 실패 코드 목록(`features/clone/clone-logic.ts`의 `CLONE_FAILURE_CODES` 등)은 이 유니온과 같아야 한다.
