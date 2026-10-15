import type { Pin } from '../domain/pin'

// 고정 저장소. 응답은 항상 바뀐 뒤의 전체 고정 목록(위치 순).
// 저장소 사용 가능 여부(available/unavailable)는 화면 조회 계층이 붙인다.
declare module './contract' {
  interface IpcInvokeChannels {
    'pins:list': { req: void; res: Pin[] }
    'pins:pin': { req: { repoId: number }; res: Pin[] }
    'pins:unpin': { req: { repoId: number }; res: Pin[] }
    'pins:reorder': { req: { repoIds: number[] }; res: Pin[] }
  }
  interface IpcEventChannels {
    'pins:changed': { pins: Pin[] }
  }
}

export {}
