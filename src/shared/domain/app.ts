export type AppPlatform = 'darwin' | 'win32' | 'linux'

export interface AppInfo {
  name: string
  version: string
  platform: AppPlatform
  /** 화면 테스트 모드로 실행 중인지 */
  testMode: boolean
}
