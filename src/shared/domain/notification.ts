/** 알림 상태 (spec §7). 완료(done)한 알림은 목록에 없다 */
export type NotificationState = 'unread' | 'read'

export const NOTIFICATION_STATES: readonly NotificationState[] = ['unread', 'read']

/** Inbox 행 (spec §4.3) */
export interface NotificationRow {
  /** GitHub 스레드 ID */
  threadId: string
  state: NotificationState
  /** GitHub 가 주는 사유(review_requested, mention, assign …) */
  reason: string
  subjectTitle: string
  /** PullRequest · Issue · Release · Commit · Discussion · CheckSuite … */
  subjectType: string
  /** 브라우저로 열 GitHub 웹 주소 */
  url: string
  repoId: number | null
  repoFullName: string
  updatedAt: string
}

export interface NotificationListOptions {
  unreadOnly?: boolean
  repoId?: number
  reason?: string
  limit?: number
}
