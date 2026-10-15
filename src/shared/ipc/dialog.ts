// 폴더 고르기 대화상자(클론 위치 선택, 폴더 직접 연결, 기본 클론 폴더 변경에 쓴다).
declare module './contract' {
  interface IpcInvokeChannels {
    'dialog:chooseFolder': { req: { defaultPath?: string }; res: { path: string | null } }
  }
}

export {}
