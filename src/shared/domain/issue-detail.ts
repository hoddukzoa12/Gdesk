import type { ActorSummary } from './actor'
import type { IssueLabel } from './issue'
import { WRITE_PERMISSIONS } from './repo'
import type { ViewerPermission } from './repo'

/**
 * 이슈 상세 (spec §6.2). 이슈는 숫자 저장소 ID + 이슈 번호로 식별한다.
 * 메인이 GitHub 에서 받아 캐시에 둔 값이며, 화면은 `query:issueDetail` 로 읽는다.
 * 본문·코멘트의 HTML 은 GitHub 가 만든 `bodyHTML` 그대로다(화면이 안전하게 그린다).
 */

/** 이슈 한 개를 가리키는 키 */
export interface IssueRef {
  repoId: number
  number: number
}

/** GitHub `ReactionContent` 8종(표시 순서) */
export const REACTION_CONTENTS = [
  'THUMBS_UP',
  'THUMBS_DOWN',
  'LAUGH',
  'HOORAY',
  'CONFUSED',
  'HEART',
  'ROCKET',
  'EYES'
] as const
export type ReactionContent = (typeof REACTION_CONTENTS)[number]

export interface ReactionGroup {
  content: ReactionContent
  /** 반응한 사람 수(GitHub `reactors.totalCount`) */
  count: number
  viewerHasReacted: boolean
}

export type IssueState = 'open' | 'closed'
export const ISSUE_STATES: readonly IssueState[] = ['open', 'closed']

/** 닫힌 이유. 열린 이슈(다시 연 이슈 포함)는 null */
export type IssueStateReason = 'completed' | 'not_planned' | 'duplicate'
export const ISSUE_STATE_REASONS: readonly IssueStateReason[] = [
  'completed',
  'not_planned',
  'duplicate'
]

export type LinkedPullRequestState = 'open' | 'merged' | 'closed'
export const LINKED_PULL_REQUEST_STATES: readonly LinkedPullRequestState[] = [
  'open',
  'merged',
  'closed'
]

/** 이 이슈를 참조하거나 닫는 PR */
export interface LinkedPullRequest {
  number: number
  title: string
  state: LinkedPullRequestState
  /** `owner/name` */
  repoFullName: string
  url: string
}

/** 이 이슈를 참조한 커밋 */
export interface ReferencingCommit {
  sha: string
  /** 메시지 첫 줄 */
  message: string
  /** GitHub 사용자와 연결된 작성자. 없으면 null(authorName 을 쓴다) */
  author: ActorSummary | null
  authorName: string | null
  /** ISO 8601 */
  committedAt: string | null
  url: string
  /** 커밋이 있는 저장소 `owner/name` */
  repoFullName: string
}

export interface IssueComment {
  /** GraphQL 노드 ID */
  id: string
  author: ActorSummary
  createdAt: string
  bodyHTML: string
  reactions: ReactionGroup[]
}

export interface IssueDetail {
  /** GraphQL 노드 ID */
  id: string
  repoId: number
  repoFullName: string
  number: number
  url: string
  title: string
  state: IssueState
  stateReason: IssueStateReason | null
  author: ActorSummary
  createdAt: string
  bodyHTML: string
  labels: IssueLabel[]
  assignees: ActorSummary[]
  reactions: ReactionGroup[]
  /** 오래된 것부터, 앞에서 일부(기본 100개) */
  comments: IssueComment[]
  /** 코멘트 전체 수(GitHub totalCount) */
  commentCount: number
  linkedPullRequests: LinkedPullRequest[]
  referencingCommits: ReferencingCommit[]
  locked: boolean
  viewerCanClose: boolean
  viewerCanReopen: boolean
  viewerCanReact: boolean
  /** 받을 때의 저장소 권한. 모르면 null */
  viewerPermission: ViewerPermission | null
  /** canCommentOnIssue(locked, viewerPermission) */
  viewerCanComment: boolean
  /** 마지막으로 받은 시각(epoch ms) */
  fetchedAt: number
}

/**
 * 코멘트를 달 수 있는가: 잠긴 이슈이면서 저장소 쓰기 권한(push·maintain·admin)이 없으면 못 단다.
 * 그 밖에는 단다.
 */
export function canCommentOnIssue(
  locked: boolean,
  viewerPermission: ViewerPermission | null
): boolean {
  if (!locked) return true
  return viewerPermission !== null && WRITE_PERMISSIONS.includes(viewerPermission)
}

/** 새 이슈 만들기의 저장소 선택 항목. 이슈를 끈 저장소도 보이지만 고를 수 없다 */
export interface IssueRepoOption {
  repoId: number
  owner: string
  name: string
  /** `owner/name` */
  fullName: string
  ownerAvatarUrl: string | null
  private: boolean
  hasIssuesEnabled: boolean
  viewerPermission: ViewerPermission | null
}

/** 이슈 번호로 쓸 수 있는 값인가(양의 안전한 정수). 화면에서 온 값 검사용 */
export function isIssueNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** 화면에서 온 이슈 키 검사: 저장소 ID·이슈 번호 모두 양의 안전한 정수. 아니면 던진다(잘못된 요청) */
export function assertIssueRef(value: unknown): asserts value is IssueRef {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid issue reference')
  const { repoId, number } = value as Record<string, unknown>
  if (!isIssueNumber(repoId)) throw new Error(`Invalid repository id: ${String(repoId)}`)
  if (!isIssueNumber(number)) throw new Error(`Invalid issue number: ${String(number)}`)
}
