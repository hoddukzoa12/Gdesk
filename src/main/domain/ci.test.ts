import { describe, expect, it } from 'vitest'
import { ciStatusFromRollup, summarizeCi } from './ci'

describe('ciStatusFromRollup (spec §7)', () => {
  it.each([
    ['SUCCESS', 'passing'],
    ['FAILURE', 'failing'],
    ['ERROR', 'failing'],
    ['PENDING', 'pending'],
    ['EXPECTED', 'pending'],
    [null, 'none'],
    [undefined, 'none'],
    ['', 'none'],
    // GitHub 통합 규칙이 이미 NEUTRAL·SKIPPED 를 SUCCESS 로 합친다. 모르는 값은 none
    ['NEUTRAL', 'none'],
    ['success', 'passing'],
    ['failure', 'failing']
  ] as const)('%s → %s', (state, expected) => {
    expect(ciStatusFromRollup(state)).toBe(expected)
  })
})

describe('summarizeCi', () => {
  it.each([
    [[], 'none'],
    [['passing', 'failing'], 'passing'],
    [['failing', 'passing'], 'failing'],
    [['none', 'passing'], 'none']
  ] as const)('최신 커밋 기준: %o → %s', (list, expected) => {
    expect(summarizeCi(list)).toBe(expected)
  })
})
