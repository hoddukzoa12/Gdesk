import { describe, expect, it } from 'vitest'
import { prDisplayStatus, recentCommitsViewAllUrl } from './home-activity'

describe('prDisplayStatus', () => {
  it.each([
    ['draft', 'approved', 'draft'],
    ['draft', 'changes_requested', 'draft'],
    ['open', 'changes_requested', 'changes_requested'],
    ['open', 'approved', 'approved'],
    ['open', 'review_required', 'review_required'],
    ['open', 'none', 'open']
  ] as const)('state=%s review=%s → %s (처음 맞는 규칙)', (state, reviewStatus, expected) => {
    expect(prDisplayStatus({ state, reviewStatus })).toBe(expected)
  })
})

describe('recentCommitsViewAllUrl', () => {
  it('작성자 커밋 검색(작성 시각 최신 순) 주소', () => {
    expect(recentCommitsViewAllUrl('octo-cat')).toBe(
      'https://github.com/search?q=author:octo-cat&type=commits&s=author-date&o=desc'
    )
  })

  it('login 을 주소 안전하게 넣는다', () => {
    expect(recentCommitsViewAllUrl('a b')).toBe(
      'https://github.com/search?q=author:a%20b&type=commits&s=author-date&o=desc'
    )
  })
})
