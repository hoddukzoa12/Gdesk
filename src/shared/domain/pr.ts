import type { ActorSummary } from './actor'
import type { CiStatus } from './ci'

/** PR 리뷰 상태 (spec §7) */
export type PrReviewStatus = 'approved' | 'changes_requested' | 'review_required' | 'none'

export const PR_REVIEW_STATUSES: readonly PrReviewStatus[] = [
  'approved',
  'changes_requested',
  'review_required',
  'none'
]

/** PR 상태 (spec §7). 1단계 목록은 열린 PR 만 보여 준다 */
export type PrState = 'open' | 'draft'

export const PR_STATES: readonly PrState[] = ['open', 'draft']

/** PR 목록 행 (spec §4.4) */
export interface PullRequestRow {
  /** GraphQL 노드 ID */
  id: string
  repoId: number
  repoFullName: string
  number: number
  title: string
  url: string
  author: ActorSummary
  state: PrState
  reviewStatus: PrReviewStatus
  /** 최신 커밋의 통합 CI 상태 */
  ciStatus: CiStatus
  commentCount: number
  createdAt: string
  updatedAt: string
}
