export type LocalLinkStatus = 'ok' | 'missing'

/** 저장소와 로컬 폴더의 연결. 저장소 하나에 여러 폴더를 연결할 수 있다(spec 3). */
export interface LocalLink {
  id: number
  /** GitHub 숫자 저장소 ID */
  repoId: number
  /** 화면에 보여 줄 경로(실제 경로로 풀고 끝 구분자를 뗀 값) */
  path: string
  /** 마지막 사용 시각(epoch ms). 연결한 시각으로 시작한다 */
  lastUsedAt: number
  status: LocalLinkStatus
}
