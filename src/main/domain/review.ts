import type { PrReviewStatus, PrState } from '@shared/domain/pr'

/** GitHub reviewDecision → PR 리뷰 상태 (spec §7). 그 밖의 값·null 은 none */
export function reviewStatusFromDecision(decision: string | null | undefined): PrReviewStatus {
  switch (decision) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes_requested'
    case 'REVIEW_REQUIRED':
      return 'review_required'
    default:
      return 'none'
  }
}

/** 열린 PR 의 상태: 초안이면 draft, 아니면 open */
export function prStateFromDraft(isDraft: boolean | null | undefined): PrState {
  return isDraft === true ? 'draft' : 'open'
}
