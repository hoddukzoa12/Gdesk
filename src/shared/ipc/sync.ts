import type { IssueRef } from '../domain/issue-detail'
import type { RefreshScope, SyncStatus } from '../domain/sync'

// 자동 갱신 엔진. 화면은 상세 화면 진입·이탈(setViewedRepo), 이슈 상세 패널 열림·닫힘(setViewedIssue)과 수동 새로고침(refresh)을 알린다.
// refresh 는 그 화면에 필요한 정보를 바로 받아 저장한 뒤 끝난다(결과 화면은 data:changed 로 다시 읽는다).
declare module './contract' {
  interface IpcInvokeChannels {
    'sync:getStatus': { req: void; res: SyncStatus }
    'sync:refresh': { req: { scope: RefreshScope }; res: void }
    'sync:setViewedRepo': { req: { repoId: number | null }; res: void }
    /** 이슈 상세 패널 열림(이슈)·닫힘(null). 열면 바로 받고, 보는 동안 목록 주기로 다시 받는다 */
    'sync:setViewedIssue': { req: IssueRef | null; res: void }
  }
  interface IpcEventChannels {
    'sync:status': SyncStatus
  }
}

export {}
