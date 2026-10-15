import type { ActionAvailability, ActionResult } from '@shared/domain/actions'
import type { NotificationRow } from '@shared/domain/notification'

/** 화면 필터 값. repo 는 저장소 전체 이름(빈 문자열이면 전체), reason 도 빈 문자열이면 전체 */
export interface InboxFilter {
  unreadOnly: boolean
  repo: string
  reason: string
}

export const DEFAULT_FILTER: InboxFilter = { unreadOnly: false, repo: '', reason: '' }

/** 번역이 있는 사유. 그 밖의 사유는 원래 값을 읽기 좋게 바꿔 보여 준다 */
export const KNOWN_REASONS = [
  'review_requested',
  'mention',
  'team_mention',
  'assign',
  'author',
  'comment',
  'ci_activity',
  'state_change',
  'subscribed',
  'manual',
  'invitation',
  'security_alert',
  'approval_requested',
  'member_feature_requested',
  'security_advisory_credit'
] as const

export function isKnownReason(reason: string): boolean {
  return (KNOWN_REASONS as readonly string[]).includes(reason)
}

/** 모르는 사유의 대체 문구: `some_reason` → `Some reason` */
export function fallbackReasonLabel(reason: string): string {
  const text = reason.replace(/_/g, ' ').trim()
  if (text === '') return reason
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** 사유 → 번역 키. 모르는 사유는 null(호출자가 fallbackReasonLabel 을 쓴다) */
export function reasonLabelKey(reason: string): string | null {
  return isKnownReason(reason) ? `reason.${reason}` : null
}

export function filterItems(
  items: readonly NotificationRow[],
  filter: InboxFilter
): NotificationRow[] {
  return items.filter(
    (item) =>
      (!filter.unreadOnly || item.state === 'unread') &&
      (filter.repo === '' || item.repoFullName === filter.repo) &&
      (filter.reason === '' || item.reason === filter.reason)
  )
}

/** 항목에 있는 저장소 이름(가나다순, 중복 없음) */
export function repoOptions(items: readonly NotificationRow[]): string[] {
  return [...new Set(items.map((i) => i.repoFullName).filter((name) => name !== ''))].sort((a, b) =>
    a.localeCompare(b)
  )
}

/** 항목에 있는 사유. 알려진 사유는 정해진 순서로 먼저, 그 밖은 이름순으로 뒤에 */
export function reasonOptions(items: readonly NotificationRow[]): string[] {
  const present = new Set(items.map((i) => i.reason).filter((r) => r !== ''))
  const known = KNOWN_REASONS.filter((r) => present.has(r))
  const unknown = [...present].filter((r) => !isKnownReason(r)).sort()
  return [...known, ...unknown]
}

/** 고른 저장소·사유가 목록에서 사라졌으면(완료 처리 등) 그 필터를 푼다 */
export function normalizeFilter(
  filter: InboxFilter,
  items: readonly NotificationRow[]
): InboxFilter {
  const repo = filter.repo !== '' && !items.some((i) => i.repoFullName === filter.repo)
  const reason = filter.reason !== '' && !items.some((i) => i.reason === filter.reason)
  if (!repo && !reason) return filter
  return { ...filter, repo: repo ? '' : filter.repo, reason: reason ? '' : filter.reason }
}

export type SubjectKind = 'pull' | 'issue' | 'release' | 'discussion' | 'commit' | 'other'

export function subjectKind(subjectType: string): SubjectKind {
  switch (subjectType) {
    case 'PullRequest':
      return 'pull'
    case 'Issue':
      return 'issue'
    case 'Release':
      return 'release'
    case 'Discussion':
      return 'discussion'
    case 'Commit':
      return 'commit'
    default:
      return 'other'
  }
}

export interface RowClickDeps {
  openExternal: (url: string) => Promise<unknown>
  markRead: (threadId: string) => Promise<ActionResult>
}

/**
 * 행 누르기: 먼저 GitHub 페이지를 브라우저로 열고, 안 읽은 항목이고 쓰기가 가능할 때만 읽음 처리한다.
 * 읽음 처리를 하지 않았으면 null 을 돌려준다.
 */
export async function openInboxItem(
  item: NotificationRow,
  availability: ActionAvailability | null,
  deps: RowClickDeps
): Promise<ActionResult | null> {
  await deps.openExternal(item.url)
  if (item.state !== 'unread' || availability?.available !== true) return null
  return deps.markRead(item.threadId)
}
