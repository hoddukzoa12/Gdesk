import type { Settings, SettingsPatch } from '../domain/settings'

// 설정. update 는 일부 필드 패치를 받아 검사 후 저장하고 전체 설정을 돌려준다.
declare module './contract' {
  interface IpcInvokeChannels {
    'settings:get': { req: void; res: Settings }
    'settings:update': { req: SettingsPatch; res: Settings }
  }
  interface IpcEventChannels {
    'settings:changed': Settings
  }
}

export {}
