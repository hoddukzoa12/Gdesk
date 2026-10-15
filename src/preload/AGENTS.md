# src/preload — 화면에 노출하는 통로

## 맡는 것

`contextBridge.exposeInMainWorld('gdesk', api)`로 화면에 두 함수만 노출한다.

- `invoke(channel, ...args)` → `ipcRenderer.invoke`
- `on(event, listener)` → `ipcRenderer.on`, 구독 해제 함수를 돌려준다. 리스너에는 Electron 이벤트 객체를 넘기지 않고 값만 넘긴다.

`api.d.ts`는 `window.gdesk`의 타입을 `src/shared/ipc/contract.ts`의 `GdeskApi`로 선언한다.

## 맡지 않는 것

- 기능별 함수, 채널별 래퍼, 데이터 가공. 기능은 `src/shared/ipc`에 계약을, `src/main`에 처리기를 둔다. 새 기능 때문에 이 폴더를 고치지 않는다.
- 토큰, 파일 시스템, Node 모듈.

## 반드시 지킬 것

- 노출하는 것은 `window.gdesk`의 `invoke`·`on` 두 개뿐이다. `ipcRenderer` 자체, `require`, `process`, Electron 객체를 노출하지 않는다. 화면 창은 `contextIsolation`·`sandbox`가 켜져 있어 이 두 함수가 메인으로 가는 유일한 길이다.
- 리스너에 `IpcRendererEvent`를 넘기지 않는다. 그 객체로 `sender`에 접근할 수 있다.
- 채널 이름을 여기서 거르지 않는다. 대신 메인 처리기가 등록된 채널만 받고 요청 값을 다시 검사한다. 여기에 허용 목록을 더하면 기능을 더할 때마다 이 파일을 고쳐야 하고, 목록이 계약과 어긋나면 화면에서 조용히 실패한다.
- 프리로드는 sandbox에서 돌아 Node 모듈을 쓸 수 없다. `electron`의 `contextBridge`·`ipcRenderer` 외에는 import하지 않는다.

## 테스트

단위 테스트는 없다. 이 통로는 화면 자동 테스트(`tests/e2e`)가 매번 지난다. 바꿨다면 `pnpm test:e2e`의 스모크 시나리오(앱 틀 표시, 세션 조회)가 통과하는지 확인한다.
