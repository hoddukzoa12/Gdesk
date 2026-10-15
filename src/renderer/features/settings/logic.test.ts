import { describe, expect, it } from 'vitest'
import { HOME_CARD_IDS, resolveHomeCards } from '@shared/domain/homeCards'
import type { Settings } from '@shared/domain/settings'
import {
  editorOptions,
  editorPatch,
  homeCardsPatch,
  moveHomeCard,
  preferencesPatch,
  settingsToPreferences,
  toggleHomeCard
} from './logic'

const base: Settings = {
  cloneBaseDir: '/Users/me/GitHub',
  cloneProtocol: 'https',
  defaultEditor: null,
  language: 'system',
  theme: 'system',
  homeCards: []
}

describe('테마·언어 ↔ 설정', () => {
  it('설정을 못 읽었으면 undefined, 읽었으면 테마·언어만 넘긴다', () => {
    expect(settingsToPreferences(undefined)).toBeUndefined()
    expect(settingsToPreferences({ ...base, theme: 'dark', language: 'ko' })).toEqual({
      theme: 'dark',
      language: 'ko'
    })
  })

  it('바뀐 항목만 패치에 담는다', () => {
    expect(preferencesPatch(base, { theme: 'light', language: 'system' })).toEqual({
      theme: 'light'
    })
    expect(preferencesPatch(base, { theme: 'system', language: 'en' })).toEqual({
      language: 'en'
    })
    expect(preferencesPatch(base, { theme: 'system', language: 'system' })).toBeNull()
  })

  it('설정을 아직 못 읽었으면 두 항목을 모두 보낸다', () => {
    expect(preferencesPatch(undefined, { theme: 'dark', language: 'ko' })).toEqual({
      theme: 'dark',
      language: 'ko'
    })
  })
})

describe('홈 카드', () => {
  const defaults = resolveHomeCards([])

  it('끄면 그 카드만 enabled=false 이고 다섯 개가 기본 순서로 저장된다', () => {
    const patch = homeCardsPatch(toggleHomeCard(defaults, 'failedCi', false))
    expect(patch).toEqual({
      homeCards: [
        { id: 'reviewRequests', enabled: true },
        { id: 'unreadNotifications', enabled: true },
        { id: 'failedCi', enabled: false },
        { id: 'unanswered', enabled: true },
        { id: 'starChanges', enabled: true }
      ]
    })
  })

  it('위·아래로 옮기고, 끝에서는 그대로다', () => {
    let cards = defaults
    for (let i = 0; i < 4; i++) cards = moveHomeCard(cards, 'starChanges', -1)
    expect(cards.map((c) => c.id)).toEqual([
      'starChanges',
      'reviewRequests',
      'unreadNotifications',
      'failedCi',
      'unanswered'
    ])
    expect(moveHomeCard(cards, 'starChanges', -1)).toEqual(cards)
    expect(moveHomeCard(cards, 'unanswered', 1)).toEqual(cards)
    expect(
      moveHomeCard(cards, 'reviewRequests', 1)
        .map((c) => c.id)
        .slice(0, 3)
    ).toEqual(['starChanges', 'unreadNotifications', 'reviewRequests'])
  })

  it('모르는 ID·중복은 버리고 빠진 카드는 켠 채로 붙여 아는 ID 다섯 개만 저장한다', () => {
    const patch = homeCardsPatch([
      { id: 'starChanges', enabled: false },
      { id: 'bogus', enabled: false },
      { id: 'starChanges', enabled: true },
      { id: 'failedCi', enabled: false }
    ])
    expect(patch.homeCards.map((c) => c.id)).toEqual([
      'starChanges',
      'failedCi',
      'reviewRequests',
      'unreadNotifications',
      'unanswered'
    ])
    expect(patch.homeCards.every((c) => (HOME_CARD_IDS as readonly string[]).includes(c.id))).toBe(
      true
    )
    expect(patch.homeCards.find((c) => c.id === 'starChanges')?.enabled).toBe(false)
    expect(patch.homeCards.find((c) => c.id === 'reviewRequests')?.enabled).toBe(true)
  })

  it('저장 패치에는 id·enabled 외의 값이 없다', () => {
    const extra = defaults.map((c) => ({ ...c, label: 'x' }))
    for (const card of homeCardsPatch(extra).homeCards) {
      expect(Object.keys(card).sort()).toEqual(['enabled', 'id'])
    }
  })
})

describe('기본 편집기 선택지', () => {
  const editors = [
    { id: 'vscode', name: 'Visual Studio Code' },
    { id: 'zed', name: 'Zed' }
  ]

  it('없음(자동) + 찾은 편집기', () => {
    expect(editorOptions(editors, null)).toEqual([
      { value: '', label: '', kind: 'none' },
      { value: 'vscode', label: 'Visual Studio Code', kind: 'detected' },
      { value: 'zed', label: 'Zed', kind: 'detected' }
    ])
  })

  it('저장된 편집기가 목록에 없으면 missing 으로 덧붙인다', () => {
    expect(editorOptions(editors, 'sublime').at(-1)).toEqual({
      value: 'sublime',
      label: 'sublime',
      kind: 'missing'
    })
    expect(editorOptions(editors, 'zed')).toHaveLength(3)
  })

  it('편집기가 없으면 없음(자동)만', () => {
    expect(editorOptions([], null)).toEqual([{ value: '', label: '', kind: 'none' }])
  })

  it('선택 값을 패치로: 빈 값은 null', () => {
    expect(editorPatch('')).toEqual({ defaultEditor: null })
    expect(editorPatch('zed')).toEqual({ defaultEditor: 'zed' })
  })
})
