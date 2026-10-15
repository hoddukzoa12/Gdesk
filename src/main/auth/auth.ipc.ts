import { shell } from 'electron'
import '@shared/ipc/auth'
import { emit, handle } from '../ipc/registry'
import { getAuthService, onAuthChanged } from './index'

// 응답·이벤트는 SessionSnapshot/AuthResult 뿐이다. 토큰은 메인 밖으로 나가지 않는다.
// 서비스는 호출 시점에 가져온다(IPC 등록이 initAuth 보다 먼저일 수 있다).
export function registerIpc(): void {
  handle('auth:getSession', () => getAuthService().getSession())
  handle('auth:loginWithToken', ({ token }) => getAuthService().loginWithToken(token))
  handle('auth:startDeviceFlow', () => getAuthService().startDeviceFlow())
  handle('auth:cancelDeviceFlow', () => getAuthService().cancelDeviceFlow())
  handle('auth:openVerificationUri', () =>
    getAuthService().openVerificationUri((url) => shell.openExternal(url))
  )
  handle('auth:logout', () => getAuthService().logout())
  handle('auth:chooseInsecureStorage', ({ choice }) =>
    getAuthService().chooseInsecureStorage(choice)
  )

  onAuthChanged((session) => emit('auth:changed', session))
}
