// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { GdeskApi } from '@shared/ipc/contract'
import type { HomeSummary } from '@shared/domain/home'
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

const summary: HomeSummary = {
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

let invoke: ReturnType<typeof vi.fn>
let emitSettings: ((settings: Settings) => void) | null

function stub(homeCards: HomeCardSetting[] = []): void {
  emitSettings = null
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'query:home') return summary
    if (channel === 'settings:get') return settingsWith(homeCards)
    if (channel === 'app:openExternal') return { opened: true }
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
  return <div data-testid="location">{location.pathname + location.hash}</div>
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
  it('기본 설정이면 다섯 카드를 기본 순서로 그린다', async () => {
    stub()
    renderPage()
    expect(await screen.findByTestId('home-card-reviewRequests')).toBeTruthy()
    expect(cardOrder()).toEqual([
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

  it('꺼진 카드는 숨기고 설정 순서를 지킨다', async () => {
    stub([
      { id: 'starChanges', enabled: true },
      { id: 'failedCi', enabled: false },
      { id: 'unknownCard', enabled: true },
      { id: 'unanswered', enabled: true }
    ])
    renderPage()
    await screen.findByTestId('home-card-starChanges')
    expect(cardOrder()).toEqual([
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
    expect(cardOrder()).toHaveLength(4)
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
  })
})
