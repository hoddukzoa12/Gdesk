import type { UpdaterStatus } from '../domain/updater'

// 자동 업데이트. 설정 화면의 "업데이트 확인" 버튼과 알림 배너가 쓴다.
declare module './contract' {
  interface IpcInvokeChannels {
    'updater:getStatus': { req: void; res: UpdaterStatus }
    /** 지금 확인한다. 이미 확인·다운로드 중이면 현재 상태를 돌려준다. */
    'updater:check': { req: void; res: UpdaterStatus }
    /** 내려받은 업데이트를 적용하며 재시작한다(ready 일 때만). */
    'updater:install': { req: void; res: { accepted: boolean } }
    /** GitHub Releases 다운로드 페이지를 브라우저로 연다. */
    'updater:openDownloadPage': { req: void; res: { opened: boolean } }
  }
  interface IpcEventChannels {
    'updater:status': UpdaterStatus
  }
}

export {}
