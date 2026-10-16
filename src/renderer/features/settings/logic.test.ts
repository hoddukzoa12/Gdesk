import { describe, expect, it } from 'vitest'
import { HOME_SECTION_IDS, isHomeSectionId, resolveHomeSections } from '@shared/domain/homeCards'
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
  const defaults = resolveHomeSections([])
  const ALL = [...HOME_SECTION_IDS]

  it('기본은 열 개 모두 켬, 기본 순서', () => {
    expect(defaults.map((c) => c.id)).toEqual(ALL)
    expect(defaults.every((c) => c.enabled)).toBe(true)
  })

  it('끄면 그 영역만 enabled=false 이고 열 개가 기본 순서로 저장된다', () => {
    const patch = homeCardsPatch(toggleHomeCard(defaults, 'contributions', false))
    expect(patch).toEqual({
      homeCards: ALL.map((id) => ({ id, enabled: id !== 'contributions' }))
    })
  })

  it('위·아래로 옮기고, 끝에서는 그대로다', () => {
    let cards = defaults
    for (let i = 0; i < ALL.length - 1; i++) cards = moveHomeCard(cards, 'starChanges', -1)
    expect(cards.map((c) => c.id)).toEqual([
      'starChanges',
      ...ALL.filter((id) => id !== 'starChanges')
    ])
    expect(moveHomeCard(cards, 'starChanges', -1)).toEqual(cards)
    expect(moveHomeCard(cards, 'unanswered', 1)).toEqual(cards)
    expect(
      moveHomeCard(cards, 'stats', 1)
        .map((c) => c.id)
        .slice(0, 3)
    ).toEqual(['starChanges', 'pinnedRepos', 'stats'])
  })

  it('모르는 ID·중복은 버리고 빠진 영역은 켠 채로 채워 아는 ID 열 개만 저장한다', () => {
    const patch = homeCardsPatch([
      { id: 'starChanges', enabled: false },
      { id: 'bogus', enabled: false },
      { id: 'starChanges', enabled: true },
      { id: 'recentCommits', enabled: false }
    ])
    expect(patch.homeCards.map((c) => c.id)).toEqual([
      'starChanges',
      'recentCommits',
      'stats',
      'pinnedRepos',
      'contributions',
      'myPullRequests',
      'reviewRequests',
      'unreadNotifications',
      'failedCi',
      'unanswered'
    ])
    expect(patch.homeCards.every((c) => isHomeSectionId(c.id))).toBe(true)
    expect(patch.homeCards.find((c) => c.id === 'starChanges')?.enabled).toBe(false)
    expect(patch.homeCards.find((c) => c.id === 'recentCommits')?.enabled).toBe(false)
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
