import { describe, expect, it } from 'vitest'
import en from '../../locales/en/palette.json'
import ko from '../../locales/ko/palette.json'
import type { RepositorySummary } from '@shared/domain/repo'
import { COMMANDS, filterCommands, matchesText } from './commands'
import type { LabeledCommand } from './commands'
import {
  blockedGitHubState,
  buildCloneSection,
  buildSections,
  flattenItems,
  moveIndex
} from './palette-logic'

function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

const labeled = (dict: unknown): LabeledCommand[] =>
  COMMANDS.map((c) => ({ ...c, label: lookup(dict, c.labelKey) ?? c.labelKey }))

function repo(id: number, fullName: string, patch: Partial<RepositorySummary> = {}) {
  const [owner = '', name = ''] = fullName.split('/')
  return {
    id,
    owner,
    name,
    fullName,
    description: null,
    accessStatus: 'available',
    ...patch
  } as RepositorySummary
}

describe('명령 목록', () => {
  it('화면 이동·새로고침·클론·테마·언어·설정을 이 순서로 갖는다', () => {
    expect(COMMANDS.map((c) => c.id)).toEqual([
      'go-home',
      'go-inbox',
      'go-pulls',
      'go-reviews',
      'go-issues',
      'go-starred',
      'go-repositories',
      'go-settings',
      'refresh',
      'clone',
      'theme-dark',
      'theme-light',
      'theme-system',
      'language-en',
      'language-ko',
      'language-system'
    ])
    expect(COMMANDS.find((c) => c.id === 'go-inbox')?.action).toEqual({
      type: 'navigate',
      path: '/inbox'
    })
    expect(COMMANDS.find((c) => c.id === 'theme-dark')?.action).toEqual({
      type: 'theme',
      value: 'dark'
    })
  })

  it.each([
    ['en', en],
    ['ko', ko]
  ])('모든 명령 문구가 %s 에 있다', (_lng, dict) => {
    for (const c of COMMANDS) expect(lookup(dict, c.labelKey), c.labelKey).toBeTruthy()
  })
})

describe('명령 거르기', () => {
  it('빈 검색어는 모두, 아니면 보이는 문구에 낱말이 모두 들어간 것만(대소문자 무관)', () => {
    const commands = labeled(en)
    expect(filterCommands(commands, '')).toHaveLength(COMMANDS.length)
    expect(filterCommands(commands, 'INBOX').map((c) => c.id)).toEqual(['go-inbox'])
    expect(filterCommands(commands, 'theme dark').map((c) => c.id)).toEqual(['theme-dark'])
    expect(filterCommands(commands, 'Theme: Dark').map((c) => c.id)).toEqual(['theme-dark'])
    expect(filterCommands(commands, 'clone').map((c) => c.id)).toEqual(['clone'])
    expect(filterCommands(commands, 'gdesk-demo')).toEqual([])
  })

  it('한국어 화면에서도 영어 낱말로 찾는다', () => {
    const commands = labeled(ko)
    expect(filterCommands(commands, '알림함').map((c) => c.id)).toEqual(['go-inbox'])
    expect(filterCommands(commands, 'inbox').map((c) => c.id)).toEqual(['go-inbox'])
    expect(filterCommands(commands, '테마').map((c) => c.id)).toEqual([
      'theme-dark',
      'theme-light',
      'theme-system'
    ])
  })

  it('matchesText', () => {
    expect(matchesText('octo/gdesk-demo A demo', '  demo   octo ')).toBe(true)
    expect(matchesText('octo/gdesk-demo', 'demo zzz')).toBe(false)
  })
})

describe('구역 만들기', () => {
  const local = {
    repositories: [repo(101, 'octo/gdesk-demo')],
    pullRequests: [
      {
        id: 'PR_1',
        repoId: 101,
        repoFullName: 'octo/gdesk-demo',
        number: 42,
        title: 'Fix',
        url: 'https://github.com/octo/gdesk-demo/pull/42'
      }
    ],
    issues: []
  } as never

  it('명령 → 저장소 → PR → 이슈 → GitHub 순서, 빈 앱 안 구역은 뺀다', () => {
    const sections = buildSections({
      commands: labeled(en).slice(0, 1),
      local,
      github: {
        status: 'ok',
        items: [{ id: 301, fullName: 'up/awesome', stargazerCount: 5 }] as never
      }
    })
    expect(sections.map((s) => s.id)).toEqual([
      'commands',
      'repositories',
      'pullRequests',
      'github'
    ])
    expect(flattenItems(sections).map((i) => i.key)).toEqual([
      'command-go-home',
      'repo-101',
      'pr-PR_1',
      'github-301'
    ])
    const [, repoSection, prSection, gh] = sections
    expect(repoSection?.items[0]?.action).toEqual({ type: 'navigate', path: '/repos/101' })
    expect(prSection?.items[0]?.action).toEqual({
      type: 'external',
      url: 'https://github.com/octo/gdesk-demo/pull/42'
    })
    expect(prSection?.items[0]?.hint).toBe('#42')
    expect(gh?.items[0]?.action).toEqual({ type: 'navigate', path: '/repos/301' })
  })

  it.each([
    'offline',
    'session_expired',
    'api_limited',
    'rate_limited',
    'error',
    'loading'
  ] as const)('GitHub 구역은 %s 안내를 결과 대신 보인다', (status) => {
    const sections = buildSections({ commands: [], local: null, github: { status } })
    expect(sections).toEqual([{ id: 'github', items: [], note: status }])
  })

  it.each([
    ['offline', 'offline'],
    ['session_expired', 'session_expired'],
    ['rate_limited', 'api_limited']
  ] as const)('연결이 %s 이면 GitHub 검색을 막고 %s 안내를 보인다', (connection, status) => {
    expect(blockedGitHubState(connection)).toEqual({ status })
    for (const dict of [en, ko]) expect(lookup(dict, `notes.${status}`)).toBeTruthy()
  })

  it('연결이 online 이거나 아직 모르면 GitHub 검색을 막지 않는다', () => {
    expect(blockedGitHubState('online')).toBeNull()
    expect(blockedGitHubState(undefined)).toBeNull()
  })

  it('GitHub 결과가 없으면 empty 안내, 검색 전(idle)이면 구역이 없다', () => {
    expect(
      buildSections({ commands: [], local: null, github: { status: 'ok', items: [] } })
    ).toEqual([{ id: 'github', items: [], note: 'empty' }])
    expect(buildSections({ commands: [], local: null, github: { status: 'idle' } })).toEqual([])
  })

  it('클론 구역: 내 저장소를 거르고 앱 안 검색 저장소를 중복 없이 붙인다', () => {
    const mine = [repo(1, 'me/alpha'), repo(2, 'me/beta', { description: 'Alpha helper' })]
    const section = buildCloneSection(mine, [repo(1, 'me/alpha'), repo(3, 'up/alpha-x')], 'alpha')
    expect(section.items.map((i) => i.key)).toEqual(['clone-1', 'clone-2', 'clone-3'])
    expect(section.items[2]?.action).toEqual({
      type: 'clone',
      target: { repoId: 3, owner: 'up', name: 'alpha-x' }
    })
    expect(buildCloneSection(mine, [], 'zzz')).toEqual({ id: 'clone', items: [], note: 'empty' })
  })
})

describe('moveIndex', () => {
  it.each([
    [0, 1, 3, 1],
    [2, 1, 3, 0],
    [0, -1, 3, 2],
    [-1, 1, 3, 0],
    [-1, -1, 3, 2],
    [5, 1, 3, 0],
    [0, 1, 0, -1]
  ])('(%i, %i, %i) → %i', (index, delta, count, expected) => {
    expect(moveIndex(index, delta, count)).toBe(expected)
  })
})
