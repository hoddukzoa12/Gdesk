/**
 * 오류 보고(spec §9). 화면으로 가는 값은 모두 지우기(scrub)를 마친 것이다.
 * 토큰·폴더 경로·저장소 소유자와 이름·사용자 이름은 여기에 남지 않는다.
 */

/** 오류가 난 곳: 앱 프로세스(main) 또는 화면(renderer) */
export type CrashProcess = 'main' | 'renderer'

/** 보내기 방식. issue: Gdesk 저장소의 새 이슈 페이지를 연다, copy: 저장소 주소가 없어 클립보드에 복사한다 */
export type CrashSendMode = 'issue' | 'copy'

export interface CrashReport {
  /** 이 실행 안에서만 쓰는 식별자 */
  id: string
  process: CrashProcess
  appVersion: string
  /** macOS, Windows, Linux 등 */
  osName: string
  osVersion: string
  /** 지운 오류 메시지 */
  message: string
  /** 지운 호출 스택(없으면 빈 문자열) */
  stack: string
  /** 이슈 제목(지운 메시지 첫 줄) */
  title: string
  /** 미리보기·이슈 본문·복사에 쓰는 전체 글 */
  body: string
  sendMode: CrashSendMode
}

/** 화면에서 잡은 오류. 메인이 길이를 자르고 지운 뒤 보고서를 만든다. */
export interface RendererErrorInput {
  message: string
  stack?: string | null
}

/** 미리보기·복사에 쓰는 전체 글: 제목과 본문. 이슈로 보낼 때는 제목과 본문을 따로 채운다. */
export function crashReportText(report: Pick<CrashReport, 'title' | 'body'>): string {
  return `${report.title}\n\n${report.body}`
}
