import type { RefreshScope, SyncStatus } from '../domain/sync'

// 자동 갱신 엔진. 화면은 상세 화면 진입·이탈(setViewedRepo)과 수동 새로고침(refresh)을 알린다.
// refresh 는 그 화면에 필요한 정보를 바로 받아 저장한 뒤 끝난다(결과 화면은 data:changed 로 다시 읽는다).
declare module './contract' {
  interface IpcInvokeChannels {
    'sync:getStatus': { req: void; res: SyncStatus }
    'sync:refresh': { req: { scope: RefreshScope }; res: void }
    'sync:setViewedRepo': { req: { repoId: number | null }; res: void }
  }
  interface IpcEventChannels {
    'sync:status': SyncStatus
  }
}

export {}
