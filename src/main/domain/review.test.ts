import { describe, expect, it } from 'vitest'
import { prStateFromDraft, reviewStatusFromDecision } from './review'

describe('reviewStatusFromDecision (spec §7)', () => {
  it.each([
    ['APPROVED', 'approved'],
    ['CHANGES_REQUESTED', 'changes_requested'],
    ['REVIEW_REQUIRED', 'review_required'],
    [null, 'none'],
    [undefined, 'none'],
    ['', 'none'],
    ['SOMETHING_NEW', 'none']
  ] as const)('%s → %s', (decision, expected) => {
    expect(reviewStatusFromDecision(decision)).toBe(expected)
  })
})

describe('prStateFromDraft', () => {
  it.each([
    [true, 'draft'],
    [false, 'open'],
    [null, 'open'],
    [undefined, 'open']
  ] as const)('isDraft=%s → %s', (isDraft, expected) => {
    expect(prStateFromDraft(isDraft)).toBe(expected)
  })
})
