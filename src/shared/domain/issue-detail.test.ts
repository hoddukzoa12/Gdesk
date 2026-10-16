import { describe, expect, it } from 'vitest'
import { assertIssueRef, canCommentOnIssue, isIssueNumber } from './issue-detail'
import type { ViewerPermission } from './repo'

describe('canCommentOnIssue', () => {
  const table: [boolean, ViewerPermission | null, boolean][] = [
    [false, 'ADMIN', true],
    [false, 'MAINTAIN', true],
    [false, 'WRITE', true],
    [false, 'TRIAGE', true],
    [false, 'READ', true],
    [false, null, true],
    [true, 'ADMIN', true],
    [true, 'MAINTAIN', true],
    [true, 'WRITE', true],
    [true, 'TRIAGE', false],
    [true, 'READ', false],
    [true, null, false]
  ]
  it.each(table)('locked=%s permission=%s → %s', (locked, permission, expected) => {
    expect(canCommentOnIssue(locked, permission)).toBe(expected)
  })
})

describe('isIssueNumber', () => {
  it('양의 안전한 정수만', () => {
    expect(isIssueNumber(1)).toBe(true)
    expect(isIssueNumber(0)).toBe(false)
    expect(isIssueNumber(-3)).toBe(false)
    expect(isIssueNumber(1.5)).toBe(false)
    expect(isIssueNumber('2')).toBe(false)
    expect(isIssueNumber(null)).toBe(false)
  })
})

describe('assertIssueRef', () => {
  it('저장소 ID·번호가 모두 양의 안전한 정수여야 한다', () => {
    expect(() => assertIssueRef({ repoId: 1, number: 2 })).not.toThrow()
    for (const bad of [
      null,
      undefined,
      'x',
      { repoId: 0, number: 1 },
      { repoId: 1, number: 0 },
      { repoId: 1.5, number: 1 },
      { repoId: 1, number: '2' },
      { repoId: 1 }
    ]) {
      expect(() => assertIssueRef(bad)).toThrow()
    }
  })
})
