// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { RouterProvider, createMemoryRouter } from 'react-router'
import type { GdeskApi } from '@shared/ipc/contract'
import type { ListPage } from '@shared/domain/list'
import type { PullRequestRow } from '@shared/domain/pr'
import { i18n } from '@renderer/app/i18n'
import { routes as pullsRoutes } from './route'
import { routes as reviewsRoutes } from '../reviews/route'
import { parseTab } from './useTabParam'

function pr(repoFullName: string, number: number, extra: Partial<PullRequestRow> = {}) {
  return {
    id: `${repoFullName}#${number}`,
    repoId: 1,
    repoFullName,
    number,
    title: `PR ${number}`,
    url: `https://github.example/${repoFullName}/pull/${number}`,
    author: { login: 'alice-dev', avatarUrl: null, isBot: false },
    state: 'open',
    reviewStatus: 'none',
    ciStatus: 'none',
    commentCount: 0,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    ...extra
  } satisfies PullRequestRow
}

const pages: Record<string, ListPage<PullRequestRow>> = {
  incoming: { items: [pr('o/a', 42), pr('o/a', 41)], totalCount: 2, complete: true },
  mine: { items: [pr('u/lib', 77)], totalCount: 5, complete: false },
  reviews: { items: [], totalCount: 0, complete: true }
}

let invoke: ReturnType<typeof vi.fn>

function setup(path: string, opts: { pending?: boolean } = {}) {
  invoke = vi.fn((channel: string, req?: { tab?: string }) => {
    if (opts.pending) return new Promise(() => {})
    if (channel === 'query:pulls') return Promise.resolve(pages[req?.tab ?? ''])
    if (channel === 'query:reviews') return Promise.resolve(pages.reviews)
    return Promise.resolve({ opened: true })
  })
  window.gdesk = { invoke, on: () => () => {} } as unknown as GdeskApi
  const router = createMemoryRouter([...pullsRoutes, ...reviewsRoutes], { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  return router
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('parseTab', () => {
  it('모르는 값이나 없는 값은 첫 탭', () => {
    expect(parseTab('mine', ['incoming', 'mine'] as const)).toBe('mine')
    expect(parseTab('bogus', ['incoming', 'mine'] as const)).toBe('incoming')
    expect(parseTab(null, ['incoming', 'mine'] as const)).toBe('incoming')
  })
})

describe('PullsPage', () => {
  it('기본은 Incoming 탭이고 탭 옆에 수치를 보여 준다', async () => {
    setup('/pulls')
    const page = await screen.findByTestId('pulls-page')
    await within(page).findByTestId('pr-row-o/a#42')
    expect(within(page).getByTestId('pr-row-o/a#41')).toBeTruthy()
    const incoming = screen.getByRole('tab', { name: /Incoming/ })
    expect(incoming.getAttribute('aria-selected')).toBe('true')
    expect(invoke).toHaveBeenCalledWith('query:pulls', { tab: 'incoming' })
    await waitFor(() => expect(screen.getByRole('tab', { name: /Mine/ }).textContent).toBe('Mine5'))
    expect(incoming.textContent).toBe('Incoming2')
  })

  it('주소의 ?tab=mine 으로 Mine 탭을 연다', async () => {
    setup('/pulls?tab=mine')
    await screen.findByTestId('pr-row-u/lib#77')
    expect(screen.getByRole('tab', { name: /Mine/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByTestId('pr-row-o/a#42')).toBeNull()
  })

  it('탭을 바꾸면 주소에 남고, 뒤로 가면 이전 탭', async () => {
    const router = setup('/pulls')
    await screen.findByTestId('pr-row-o/a#42')
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Mine/ }), { button: 0 })
    await screen.findByTestId('pr-row-u/lib#77')
    expect(router.state.location.search).toBe('?tab=mine')
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Incoming/ }), { button: 0 })
    await screen.findByTestId('pr-row-o/a#42')
    expect(router.state.location.search).toBe('')
    await router.navigate(-1)
    await screen.findByTestId('pr-row-u/lib#77')
    expect(router.state.location.search).toBe('?tab=mine')
  })

  it('다 받지 못한 목록은 GitHub 에서 더 보기 안내', async () => {
    setup('/pulls?tab=mine')
    const more = await screen.findByTestId('list-more')
    expect(more.textContent).toContain('Showing 1 of 5.')
    const link = within(more).getByRole('link', { name: 'More on GitHub' })
    expect(link.getAttribute('href')).toBe('https://github.example/pulls')
  })

  it('불러오는 중 표시', async () => {
    setup('/pulls', { pending: true })
    expect(await screen.findByTestId('list-loading')).toBeTruthy()
  })
})

describe('ReviewsPage', () => {
  it('빈 목록 안내', async () => {
    setup('/reviews')
    const page = await screen.findByTestId('reviews-page')
    await within(page).findByTestId('list-empty')
    expect(within(page).getByText('No review requests')).toBeTruthy()
    expect(invoke).toHaveBeenCalledWith('query:reviews')
  })
})
