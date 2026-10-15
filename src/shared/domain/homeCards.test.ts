import { describe, expect, it } from 'vitest'
import { HOME_CARD_IDS, isHomeCardId, resolveHomeCards } from './homeCards'

const allEnabled = HOME_CARD_IDS.map((id) => ({ id, enabled: true }))

describe('resolveHomeCards', () => {
  it('빈 목록이면 기본 순서로 모두 켠다', () => {
    expect(resolveHomeCards([])).toEqual(allEnabled)
    expect(HOME_CARD_IDS).toEqual([
      'reviewRequests',
      'unreadNotifications',
      'failedCi',
      'unanswered',
      'starChanges'
    ])
  })

  it('모르는 ID 는 버린다', () => {
    expect(
      resolveHomeCards([
        { id: 'legacyCard', enabled: false },
        { id: 'failedCi', enabled: false }
      ])
    ).toEqual([
      { id: 'failedCi', enabled: false },
      { id: 'reviewRequests', enabled: true },
      { id: 'unreadNotifications', enabled: true },
      { id: 'unanswered', enabled: true },
      { id: 'starChanges', enabled: true }
    ])
  })

  it('빠진 카드는 켠 채로 기본 순서대로 끝에 붙인다', () => {
    expect(resolveHomeCards([{ id: 'starChanges', enabled: false }])).toEqual([
      { id: 'starChanges', enabled: false },
      { id: 'reviewRequests', enabled: true },
      { id: 'unreadNotifications', enabled: true },
      { id: 'failedCi', enabled: true },
      { id: 'unanswered', enabled: true }
    ])
  })

  it('저장된 순서를 지킨다', () => {
    const stored = [
      { id: 'unanswered', enabled: true },
      { id: 'starChanges', enabled: false },
      { id: 'reviewRequests', enabled: true },
      { id: 'failedCi', enabled: true },
      { id: 'unreadNotifications', enabled: false }
    ]
    expect(resolveHomeCards(stored)).toEqual(stored)
  })

  it('중복 ID 는 처음 것만 쓴다', () => {
    expect(
      resolveHomeCards([
        { id: 'failedCi', enabled: false },
        { id: 'failedCi', enabled: true }
      ])[0]
    ).toEqual({ id: 'failedCi', enabled: false })
    expect(resolveHomeCards([{ id: 'failedCi', enabled: true }])).toHaveLength(5)
  })

  it('isHomeCardId', () => {
    expect(isHomeCardId('failedCi')).toBe(true)
    expect(isHomeCardId('nope')).toBe(false)
  })
})
