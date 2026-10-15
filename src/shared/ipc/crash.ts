import type { CrashReport, RendererErrorInput } from '../domain/crash'

// 오류 보고(spec §9). 앱은 직접 전송하지 않는다. 사용자가 미리 보고 "보내기"를 눌러야 브라우저가 열린다.
declare module './contract' {
  interface IpcInvokeChannels {
    /** 화면에서 처리되지 않은 오류를 메인에 알린다. 보고서를 만들었으면 accepted=true */
    'crash:reportRenderer': { req: RendererErrorInput; res: { accepted: boolean } }
    /** 아직 닫지 않은 보고서(창이 뜨기 전에 난 오류 포함) */
    'crash:pending': { req: void; res: CrashReport[] }
    /** 대화상자를 닫았다. 다시 띄우지 않는다. */
    'crash:dismiss': { req: { id: string }; res: void }
    /** Gdesk 저장소의 새 이슈 작성 페이지를 내용을 채워 브라우저로 연다(sendMode=issue) */
    'crash:openIssue': { req: { id: string }; res: { opened: boolean; truncated: boolean } }
    /** 보고 내용을 클립보드에 복사한다(sendMode=copy) */
    'crash:copy': { req: { id: string }; res: { copied: boolean } }
    /** 테스트 모드 전용: 일부러 오류를 낸다. 테스트 모드가 아니면 거부한다. */
    'crash:testTrigger': { req: { where: 'main' | 'renderer' }; res: { accepted: boolean } }
  }
  interface IpcEventChannels {
    /** 새 보고서. 화면은 미리보기 대화상자를 띄운다. */
    'crash:show': { report: CrashReport }
    /** 테스트 모드 전용: 화면이 일부러 처리되지 않은 오류를 낸다. */
    'crash:testThrow': { message: string }
  }
}

export {}
