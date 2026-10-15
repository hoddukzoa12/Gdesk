import type { ActionAvailability, ActionResult } from '../domain/actions'

// 쓰기 동작(spec §6). 화면을 먼저 바꾸고(캐시 변경 + data:changed) GitHub 에 요청하며, 실패하면 되돌린다.
// 같은 대상(저장소·스레드)에 대한 동작은 순서대로 하나씩 처리한다. 쓰기를 모아 두었다가 나중에 보내지 않는다.
declare module './contract' {
  interface IpcInvokeChannels {
    /** starred=true 면 스타, false 면 스타 취소 */
    'actions:star': { req: { repoId: number; starred: boolean }; res: ActionResult }
    'actions:markRead': { req: { threadId: string }; res: ActionResult }
    'actions:markDone': { req: { threadId: string }; res: ActionResult }
    'actions:getAvailability': { req: void; res: ActionAvailability }
  }
  interface IpcEventChannels {
    /** 쓰기 가능 여부가 바뀔 때만 보낸다 */
    'actions:availability': ActionAvailability
  }
}

export {}
