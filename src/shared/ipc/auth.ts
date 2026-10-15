import type { AuthResult, InsecureStorageChoice, SessionSnapshot } from '../domain/session'

// 로그인·세션. 어떤 응답·이벤트에도 토큰은 담지 않는다(메인 프로세스 밖으로 나가지 않는다).
declare module './contract' {
  interface IpcInvokeChannels {
    'auth:getSession': { req: void; res: SessionSnapshot }
    'auth:loginWithToken': { req: { token: string }; res: AuthResult }
    /** 기기 인증을 시작한다. 코드는 session.deviceFlow 로 온다(완료까지 기다리지 않는다) */
    'auth:startDeviceFlow': { req: void; res: AuthResult }
    'auth:cancelDeviceFlow': { req: void; res: SessionSnapshot }
    'auth:openVerificationUri': { req: void; res: { opened: boolean } }
    'auth:logout': { req: void; res: SessionSnapshot }
    'auth:chooseInsecureStorage': { req: { choice: InsecureStorageChoice }; res: SessionSnapshot }
  }
  interface IpcEventChannels {
    'auth:changed': SessionSnapshot
  }
}

export {}
