// 화면 테스트 전용 채널(테스트 모드가 아니면 거부된다).
declare module './contract' {
  interface IpcInvokeChannels {
    'local:testLaunches': {
      req: void
      res: Array<{ kind: 'spawn' | 'openPath'; command?: unknown; path?: string }>
    }
  }
}

export {}
