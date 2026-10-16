import { describe, expect, it } from 'vitest'
import {
  HOME_CARD_IDS,
  HOME_SECTION_IDS,
  NEW_HOME_SECTION_IDS,
  isHomeCardId,
  isHomeSectionId,
  resolveHomeCards,
  resolveHomeSections
} from './homeCards'

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

describe('resolveHomeSections (인사말 아래 10개 영역)', () => {
  const NEW = ['stats', 'pinnedRepos', 'contributions', 'recentCommits', 'myPullRequests']
  const OLD = ['reviewRequests', 'unreadNotifications', 'failedCi', 'unanswered', 'starChanges']
  const on = (ids: string[]) => ids.map((id) => ({ id, enabled: true }))

  it('기본 순서: 새 영역 다섯 개 → 기존 카드 다섯 개', () => {
    expect(NEW_HOME_SECTION_IDS).toEqual(NEW)
    expect(HOME_SECTION_IDS).toEqual([...NEW, ...OLD])
  })

  it('빈 목록이면 기본 순서로 모두 켠다', () => {
    expect(resolveHomeSections([])).toEqual(on([...NEW, ...OLD]))
  })

  it('새 ID 가 하나도 없으면 새 영역을 앞에 넣고 기존 카드의 켬·끔과 순서를 지킨다', () => {
    expect(
      resolveHomeSections([
        { id: 'starChanges', enabled: false },
        { id: 'reviewRequests', enabled: true },
        { id: 'failedCi', enabled: false }
      ])
    ).toEqual([
      ...on(NEW),
      { id: 'starChanges', enabled: false },
      { id: 'reviewRequests', enabled: true },
      { id: 'failedCi', enabled: false },
      // 저장된 목록에 없던 기존 카드는 켠 채로 기본 순서대로 끝에
      { id: 'unreadNotifications', enabled: true },
      { id: 'unanswered', enabled: true }
    ])
  })

  it('앞에 넣기는 한 번뿐이다(결과를 다시 풀면 그대로)', () => {
    const once = resolveHomeSections([
      { id: 'failedCi', enabled: false },
      { id: 'reviewRequests', enabled: true }
    ])
    expect(resolveHomeSections(once)).toEqual(once)
  })

  it('새 ID 가 일부 있으면 빠진 ID 만 끝에 붙인다', () => {
    expect(
      resolveHomeSections([
        { id: 'failedCi', enabled: true },
        { id: 'contributions', enabled: false },
        { id: 'reviewRequests', enabled: false }
      ])
    ).toEqual([
      { id: 'failedCi', enabled: true },
      { id: 'contributions', enabled: false },
      { id: 'reviewRequests', enabled: false },
      { id: 'stats', enabled: true },
      { id: 'pinnedRepos', enabled: true },
      { id: 'recentCommits', enabled: true },
      { id: 'myPullRequests', enabled: true },
      { id: 'unreadNotifications', enabled: true },
      { id: 'unanswered', enabled: true },
      { id: 'starChanges', enabled: true }
    ])
  })

  it('모르는 ID 와 중복 ID 는 버린다(중복은 처음 것)', () => {
    const result = resolveHomeSections([
      { id: 'legacy', enabled: false },
      { id: 'stats', enabled: false },
      { id: 'stats', enabled: true },
      { id: 'unanswered', enabled: false },
      { id: 'unanswered', enabled: true }
    ])
    expect(result).toHaveLength(10)
    expect(result.slice(0, 2)).toEqual([
      { id: 'stats', enabled: false },
      { id: 'unanswered', enabled: false }
    ])
    expect(result.some((c) => c.id === ('legacy' as never))).toBe(false)
  })

  it('모르는 ID 만 있으면 빈 목록과 같다(기본 순서로 모두 켬)', () => {
    expect(resolveHomeSections([{ id: 'legacy', enabled: false }])).toEqual(on([...NEW, ...OLD]))
  })

  it('isHomeSectionId', () => {
    expect(isHomeSectionId('pinnedRepos')).toBe(true)
    expect(isHomeSectionId('failedCi')).toBe(true)
    expect(isHomeSectionId('nope')).toBe(false)
  })
})
