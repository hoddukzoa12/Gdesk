import type { AppInfo } from '../domain/app'

// 예시 기능: 앱 정보와 외부 링크 열기. 다른 기능도 이 형식을 따른다.
declare module './contract' {
  interface IpcInvokeChannels {
    'app:info': { req: void; res: AppInfo }
    'app:openExternal': { req: { url: string }; res: { opened: boolean } }
  }
}

export {}
