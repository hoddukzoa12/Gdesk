// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { GdeskApi } from '@shared/ipc/contract'
import type { HomeActivity, MyPullRequestItem } from '@shared/domain/home-activity'
import type { HomeQueryResult } from '@shared/domain/queries'
import type { PullRequestRow } from '@shared/domain/pr'
import type { HomeCardSetting, Settings } from '@shared/domain/settings'
import { i18n } from '@renderer/app/i18n'
import { HomePage } from './HomePage'

const NOW = '2026-10-16T00:00:00.000Z'

function pr(repoId: number, repoFullName: string, number: number, title: string): PullRequestRow {
  return {
    id: `PR_${repoId}_${number}`,
    repoId,
    repoFullName,
    number,
    title,
    url: `https://github.example/${repoFullName}/pull/${number}`,
    author: { login: 'alice', avatarUrl: null, isBot: false },
    state: 'open',
    reviewStatus: 'review_required',
    ciStatus: 'failing',
    commentCount: 0,
    createdAt: NOW,
    updatedAt: NOW
  }
}

function myPr(number: number, title: string, displayStatus: MyPullRequestItem['displayStatus']) {
  return {
    ...pr(301, 'upstream-org/awesome-lib', number, title),
    author: { login: 'octo', avatarUrl: null, isBot: false },
    commentCount: 4,
    displayStatus
  }
}

/** 2025-10-12(일) … 2026-10-16(금) 370일. 수준은 날마다 돌아간다 */
function calendarDays(): NonNullable<HomeActivity['contributions']>['days'] {
  const levels = [
    'NONE',
    'FIRST_QUARTILE',
    'SECOND_QUARTILE',
    'THIRD_QUARTILE',
    'FOURTH_QUARTILE'
  ] as const
  const base = Date.parse('2025-10-12T00:00:00Z')
  return Array.from({ length: 370 }, (_, i) => {
    const d = new Date(base + i * 86_400_000)
    return {
      date: d.toISOString().slice(0, 10),
      count: i % 5,
      level: levels[i % 5] ?? 'NONE',
      weekday: d.getUTCDay()
    }
  })
}

const activity: HomeActivity = {
  stats: { commits: 842, repositories: null, openPullRequests: 4, streak: 5 },
  pinnedRepos: [
    {
      repoId: 101,
      cached: true,
      owner: 'octo-maintainer',
      name: 'gdesk-demo',
      fullName: 'octo-maintainer/gdesk-demo',
      url: 'https://github.example/octo-maintainer/gdesk-demo',
      description: 'A demo project',
      primaryLanguage: 'TypeScript',
      primaryLanguageColor: '#3178c6',
      stargazerCount: 1234,
      forkCount: 56,
      ownerAvatarUrl: null,
      accessStatus: 'available'
    },
    {
      repoId: 999,
      cached: false,
      owner: null,
      name: null,
      fullName: null,
      url: null,
      description: null,
      primaryLanguage: null,
      primaryLanguageColor: null,
      stargazerCount: null,
      forkCount: null,
      ownerAvatarUrl: null,
      accessStatus: 'unavailable'
    }
  ],
  contributions: { days: calendarDays() },
  recentCommits: {
    items: [
      {
        repoFullName: 'octo-maintainer/gdesk-demo',
        sha: 'abcdef1234567890',
        message: 'Merge pull request #38 from alice-dev/quick-search\n\nbody',
        authorAvatarUrl: null,
        authorDate: NOW,
        url: 'https://github.example/octo-maintainer/gdesk-demo/commit/abcdef1234567890'
      }
    ],
    fetched: true,
    viewAllUrl: 'https://github.example/search?q=author:octo&type=commits'
  },
  myPullRequests: {
    totalCount: 6,
    complete: true,
    items: [
      myPr(77, 'Fix memory leak', 'review_required'),
      myPr(78, 'Add docs', 'approved'),
      myPr(79, 'WIP', 'draft'),
      myPr(80, 'Refactor', 'changes_requested'),
      myPr(81, 'Tidy', 'open')
    ]
  }
}

const summary: HomeQueryResult = {
  ...activity,
  reviewRequests: {
    count: 7,
    items: [pr(201, 'gdesk-org/gdesk-core', 13, 'Add rate limit banner')],
    complete: true
  },
  unreadNotifications: { count: 0, items: [], complete: false },
  failedCi: {
    repos: [
      {
        repoId: 101,
        repoFullName: 'octo-maintainer/gdesk-demo',
        defaultBranch: 'main',
        sha: 'abcdef1234567',
        message: 'Break the build\n\nbody',
        url: 'https://github.example/octo-maintainer/gdesk-demo/commit/abcdef1',
        ciStatus: 'failing',
        committedAt: NOW
      }
    ],
    pullRequests: [pr(301, 'upstream-org/awesome-lib', 77, 'Fix memory leak')]
  },
  unansweredContributions: { count: 0, items: [], complete: true },
  starChanges: {
    windowDays: 7,
    items: [
      { repoId: 101, repoFullName: 'octo-maintainer/gdesk-demo', gained: 4, truncated: false }
    ]
  }
}

function settingsWith(homeCards: HomeCardSetting[]): Settings {
  return {
    cloneBaseDir: '/tmp/GitHub',
    cloneProtocol: 'https',
    defaultEditor: null,
    language: 'en',
    theme: 'dark',
    homeCards
  }
}

const session = {
  state: 'signed_in',
  user: {
    id: 1,
    login: 'octo-maintainer',
    name: 'Octo Maintainer',
    avatarUrl: '',
    email: null
  },
  tokenKind: 'classic',
  missingScopes: [],
  inboxAvailable: true,
  deviceFlowAvailable: false
}

let invoke: ReturnType<typeof vi.fn>
let emitSettings: ((settings: Settings) => void) | null
let home: HomeQueryResult

function stub(homeCards: HomeCardSetting[] = [], data: HomeQueryResult = summary): void {
  emitSettings = null
  home = data
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'query:home') return home
    if (channel === 'settings:get') return settingsWith(homeCards)
    if (channel === 'auth:getSession') return session
    if (channel === 'app:openExternal') return { opened: true }
    if (channel === 'pins:unpin') return []
    throw new Error(`unexpected ${channel}`)
  })
  window.gdesk = {
    invoke: invoke as unknown as GdeskApi['invoke'],
    on: ((event: string, listener: (settings: Settings) => void) => {
      if (event === 'settings:changed') emitSettings = listener
      return () => {}
    }) as GdeskApi['on']
  }
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search + location.hash}</div>
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/home']}>
          <Routes>
            <Route path="/home" element={<HomePage />} />
            <Route path="*" element={null} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

function cardOrder(): string[] {
  return screen
    .getAllByTestId(/^home-card-[A-Za-z]+$/)
    .map((el) => el.dataset.testid!.replace('home-card-', ''))
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('HomePage', () => {
  it('기본 설정이면 영역 열 개를 기본 순서로 그린다', async () => {
    stub()
    renderPage()
    expect(await screen.findByTestId('home-card-reviewRequests')).toBeTruthy()
    expect(cardOrder()).toEqual([
      'stats',
      'pinnedRepos',
      'contributions',
      'recentCommits',
      'myPullRequests',
      'reviewRequests',
      'unreadNotifications',
      'failedCi',
      'unanswered',
      'starChanges'
    ])
    // 개수와, 완전한 목록이 표시 상한에만 잘렸으면 중립적인 "+N more"
    const review = screen.getByTestId('home-card-reviewRequests')
    expect(within(review).getByText('7')).toBeTruthy()
    expect(within(review).getByTestId('home-card-reviewRequests-more').textContent).toBe('+6 more')
    // 빈 목록 + complete=false
    const unread = screen.getByTestId('home-card-unreadNotifications')
    expect(within(unread).getByText('You’re all caught up.')).toBeTruthy()
    expect(within(unread).getByText('There may be more on GitHub')).toBeTruthy()
    expect(
      within(screen.getByTestId('home-card-unanswered')).getByText(
        'Every new contribution has a response.'
      )
    ).toBeTruthy()
    expect(
      within(screen.getByTestId('home-card-starChanges')).getByText('Last 7 days')
    ).toBeTruthy()
  })

  it('근거 목록이 불완전하면(complete=false) GitHub 에 더 있을 수 있다고 알린다', async () => {
    stub()
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'settings:get') return settingsWith([])
      if (channel === 'query:home') {
        return { ...summary, reviewRequests: { ...summary.reviewRequests, complete: false } }
      }
      throw new Error(`unexpected ${channel}`)
    })
    renderPage()
    const more = await screen.findByTestId('home-card-reviewRequests-more')
    expect(more.textContent).toBe('+6 more · there may be more on GitHub')
    // 다 보여 준 완전한 목록에는 안내가 없다
    expect(screen.queryByTestId('home-card-unanswered-more')).toBeNull()
  })

  it('새 영역 전의 설정이면 새 영역을 앞에 넣고, 꺼진 카드는 숨기고 순서를 지킨다', async () => {
    stub([
      { id: 'starChanges', enabled: true },
      { id: 'failedCi', enabled: false },
      { id: 'unknownCard', enabled: true },
      { id: 'unanswered', enabled: true }
    ])
    renderPage()
    await screen.findByTestId('home-card-starChanges')
    expect(cardOrder()).toEqual([
      'stats',
      'pinnedRepos',
      'contributions',
      'recentCommits',
      'myPullRequests',
      'starChanges',
      'unanswered',
      'reviewRequests',
      'unreadNotifications'
    ])
    expect(screen.queryByTestId('home-card-failedCi')).toBeNull()
  })

  it('설정이 바뀌면 바로 반영한다', async () => {
    stub()
    renderPage()
    await screen.findByTestId('home-card-failedCi')
    expect(emitSettings).not.toBeNull()
    await act(async () => emitSettings?.(settingsWith([{ id: 'failedCi', enabled: false }])))
    await waitFor(() => expect(screen.queryByTestId('home-card-failedCi')).toBeNull())
    expect(cardOrder()).toHaveLength(9)
  })

  it('저장된 순서대로 그리고 꺼진 영역은 건너뛴다', async () => {
    stub([
      { id: 'myPullRequests', enabled: true },
      { id: 'stats', enabled: false },
      { id: 'reviewRequests', enabled: true },
      { id: 'contributions', enabled: false },
      { id: 'pinnedRepos', enabled: true },
      { id: 'recentCommits', enabled: false },
      { id: 'unreadNotifications', enabled: false },
      { id: 'failedCi', enabled: false },
      { id: 'unanswered', enabled: false },
      { id: 'starChanges', enabled: true }
    ])
    renderPage()
    await screen.findByTestId('home-card-myPullRequests')
    expect(cardOrder()).toEqual(['myPullRequests', 'reviewRequests', 'pinnedRepos', 'starChanges'])
    expect(screen.queryByTestId('home-card-stats')).toBeNull()
    expect(screen.queryByTestId('home-heatmap')).toBeNull()
  })

  it('수치 영역은 한 줄을 다 쓰고 나머지는 두 열로 흐른다', async () => {
    stub()
    renderPage()
    const stats = await screen.findByTestId('home-card-stats')
    expect(stats.parentElement?.className).toContain('col-span-full')
    expect(screen.getByTestId('home-card-pinnedRepos').parentElement?.className).not.toContain(
      'col-span-full'
    )
    expect(screen.getByTestId('home-sections').className).toContain('min-[1100px]:grid-cols-2')
  })

  it('인사말: 아바타·이름·부제, 오른쪽에 오늘의 한마디', async () => {
    stub()
    renderPage()
    const greeting = await screen.findByTestId('home-greeting')
    await waitFor(() =>
      expect(within(greeting).getByRole('heading', { level: 1 }).textContent).toBe(
        'Hello, Octo Maintainer'
      )
    )
    expect(within(greeting).getByText('Keep building, one commit at a time.')).toBeTruthy()
    expect(screen.getByTestId('home-quote').textContent).toMatch(/^“.+”$/)
  })

  it('수치: 값과 단위, 받지 못한 값은 —', async () => {
    stub()
    renderPage()
    expect((await screen.findByTestId('home-stat-commits-value')).textContent).toBe('842')
    expect(screen.getByTestId('home-stat-repositories-value').textContent).toBe('—')
    expect(screen.getByTestId('home-stat-openPullRequests-value').textContent).toBe('4')
    expect(screen.getByTestId('home-stat-streak-value').textContent).toBe('5 days')
    expect(screen.getByTestId('home-stat-commits').textContent).toContain('Commits (last year)')
  })

  it('수치가 모두 null 이면 모두 —', async () => {
    stub([], {
      ...summary,
      stats: { commits: null, repositories: null, openPullRequests: null, streak: null }
    })
    renderPage()
    await screen.findByTestId('home-card-stats')
    for (const id of ['commits', 'repositories', 'openPullRequests', 'streak']) {
      expect(screen.getByTestId(`home-stat-${id}-value`).textContent).toBe('—')
    }
  })

  it('고정 저장소: 카드는 상세로, 핀은 고정 해제, 받지 않은 고정은 #ID', async () => {
    stub()
    renderPage()
    const card = await screen.findByTestId('home-pinned-101')
    expect(card.textContent).toContain('gdesk-demo')
    expect(card.textContent).toContain('A demo project')
    expect(card.textContent).toContain('TypeScript')
    expect(card.textContent).toContain('1.2K')
    expect(card.textContent).toContain('56')
    const unloaded = screen.getByTestId('home-pinned-999')
    expect(unloaded.textContent).toContain('#999')
    expect(unloaded.textContent).toContain('Not loaded yet')
    expect(screen.getByTestId('home-pinned-999-unavailable').textContent).toBe('Unavailable')

    const unpin = screen.getByTestId('home-pinned-101-unpin')
    expect(unpin.getAttribute('title')).toBe('Unpin')
    fireEvent.click(unpin)
    expect(invoke).toHaveBeenCalledWith('pins:unpin', { repoId: 101 })
    expect(screen.getByTestId('location').textContent).toBe('/home')

    fireEvent.click(within(card).getByRole('button', { name: 'octo-maintainer/gdesk-demo' }))
    expect(screen.getByTestId('location').textContent).toBe('/repos/101')
  })

  it('고정이 없으면 안내', async () => {
    stub([], { ...summary, pinnedRepos: [] })
    renderPage()
    expect((await screen.findByTestId('home-pinned-empty')).textContent).toMatch(/Pin repositories/)
  })

  it('기여 달력: 53주 × 7행, 수준별 색, 마우스를 올리면 날짜와 개수', async () => {
    stub()
    renderPage()
    const grid = await screen.findByTestId('home-heatmap')
    const cells = within(grid).getAllByTestId('home-heat-cell')
    expect(cells).toHaveLength(369)
    const today = cells.find((c) => c.dataset.date === '2026-10-16')!
    expect(today.style.gridColumn).toBe('54') // 요일 이름 열 + 53번째 주
    expect(today.style.gridRow).toBe('5') // 금요일
    const level = today.dataset.level as string
    const expected = {
      NONE: 'bg-heat-0',
      FIRST_QUARTILE: 'bg-heat-1',
      SECOND_QUARTILE: 'bg-heat-2',
      THIRD_QUARTILE: 'bg-heat-3',
      FOURTH_QUARTILE: 'bg-heat-4'
    }[level]
    expect(today.className).toContain(expected)
    expect(today.getAttribute('title')).toMatch(/^Oct 16, 2026: \d contributions?$/)
    expect(within(grid).getByText('Mon')).toBeTruthy()
    expect(within(grid).getByText('Sun')).toBeTruthy()
    expect(screen.getByTestId('home-heatmap-legend').textContent).toBe('LessMore')
  })

  it('기여 달력을 받지 않았으면 빈 달력과 안내', async () => {
    stub([], { ...summary, contributions: null })
    renderPage()
    expect(await screen.findByTestId('home-heatmap-empty')).toBeTruthy()
    expect(screen.queryAllByTestId('home-heat-cell')).toHaveLength(0)
  })

  it('최근 커밋: 첫 줄·저장소·짧은 SHA, 누르면 GitHub, 모두 보기는 커밋 검색', async () => {
    stub()
    renderPage()
    const row = await screen.findByTestId('home-commit-abcdef1234567890')
    expect(row.textContent).toContain('Merge pull request #38 from alice-dev/quick-search')
    expect(row.textContent).not.toContain('body')
    expect(row.textContent).toContain('octo-maintainer/gdesk-demo')
    expect(row.textContent).toContain('abcdef1')
    expect(row.textContent).not.toContain('abcdef12')
    fireEvent.click(row)
    expect(invoke).toHaveBeenCalledWith('app:openExternal', {
      url: 'https://github.example/octo-maintainer/gdesk-demo/commit/abcdef1234567890'
    })
    fireEvent.click(screen.getByTestId('home-card-recentCommits-view-all'))
    expect(invoke).toHaveBeenCalledWith('app:openExternal', {
      url: 'https://github.example/search?q=author:octo&type=commits'
    })
  })

  it('최근 커밋이 없으면 안내, 받기 전이면 모두 보기도 없음', async () => {
    stub([], {
      ...summary,
      recentCommits: { items: [], fetched: true, viewAllUrl: null }
    })
    renderPage()
    expect((await screen.findByTestId('home-recent-commits-empty')).textContent).toBe(
      'No recent commits'
    )
    expect(screen.queryByTestId('home-card-recentCommits-view-all')).toBeNull()
  })

  it('내 PR: 전체 수, 상태 알약, 누르면 GitHub, 모두 보기는 Pulls 의 Mine 탭', async () => {
    stub()
    renderPage()
    const section = await screen.findByTestId('home-card-myPullRequests')
    expect(within(section).getByText('6')).toBeTruthy()
    const statuses: Record<number, [string, string]> = {
      77: ['review_required', 'Review required'],
      78: ['approved', 'Approved'],
      79: ['draft', 'Draft'],
      80: ['changes_requested', 'Changes requested'],
      81: ['open', 'Open']
    }
    for (const [number, [status, label]] of Object.entries(statuses)) {
      const pill = screen.getByTestId(`home-pr-301-${number}-status`)
      expect(pill.dataset.status).toBe(status)
      expect(pill.textContent).toBe(label)
    }
    expect(screen.getByTestId('home-pr-301-77-status').className).toContain('text-merged')
    expect(screen.getByTestId('home-pr-301-78-status').className).toContain('text-success')
    expect(screen.getByTestId('home-pr-301-80-status').className).toContain('text-danger')
    expect(screen.getByTestId('home-pr-301-77').textContent).toContain(
      '#77 · upstream-org/awesome-lib'
    )
    fireEvent.click(screen.getByTestId('home-pr-301-78'))
    expect(invoke).toHaveBeenCalledWith('app:openExternal', {
      url: 'https://github.example/upstream-org/awesome-lib/pull/78'
    })
    fireEvent.click(screen.getByTestId('home-card-myPullRequests-view-all'))
    expect(screen.getByTestId('location').textContent).toBe('/pulls?tab=mine')
  })

  it('PR 은 GitHub 로, 저장소 항목은 저장소 상세로 간다', async () => {
    stub()
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: 'gdesk-org/gdesk-core#13 Add rate limit banner' })
    )
    expect(invoke).toHaveBeenCalledWith('app:openExternal', {
      url: 'https://github.example/gdesk-org/gdesk-core/pull/13'
    })
    fireEvent.click(within(screen.getByTestId('home-row-failedCi-pr-301-77')).getByRole('button'))
    expect(invoke).toHaveBeenCalledWith('app:openExternal', {
      url: 'https://github.example/upstream-org/awesome-lib/pull/77'
    })
    fireEvent.click(within(screen.getByTestId('home-row-failedCi-repo-101')).getByRole('button'))
    expect(screen.getByTestId('location').textContent).toBe('/repos/101')
  })

  it('Customize 는 설정의 홈 카드 항목으로 간다', async () => {
    stub()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
    expect(screen.getByTestId('location').textContent).toBe('/settings#home-cards')
  })

  it('불러오기 실패는 오류 화면을 보여 준다', async () => {
    stub()
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'settings:get') return settingsWith([])
      throw new Error('boom')
    })
    renderPage()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Couldn’t load your to-do summary.')).toBeTruthy()
  })

  it('한국어 문구', async () => {
    await i18n.changeLanguage('ko')
    stub()
    renderPage()
    expect(await screen.findByText('리뷰 요청')).toBeTruthy()
    expect(screen.getByText('6개 더 있음')).toBeTruthy()
    expect(screen.getByRole('button', { name: '카드 설정' })).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
        '안녕하세요, Octo Maintainer님'
      )
    )
    expect(screen.getByTestId('home-stat-streak-value').textContent).toBe('5일')
    expect(screen.getByTestId('home-stat-commits').textContent).toContain('최근 1년 커밋')
    expect(screen.getByTestId('home-pinned-101-unpin').getAttribute('title')).toBe('고정 해제')
    expect(screen.getByText('리뷰 필요')).toBeTruthy()
  })
})
