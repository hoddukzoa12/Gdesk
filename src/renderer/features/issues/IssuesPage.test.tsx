// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { RouterProvider, createMemoryRouter } from 'react-router'
import type { GdeskApi } from '@shared/ipc/contract'
import type { IssueRow } from '@shared/domain/issue'
import type { ListPage } from '@shared/domain/list'
import { i18n } from '@renderer/app/i18n'
import { routes } from './route'

function issue(repoFullName: string, number: number, extra: Partial<IssueRow> = {}) {
  return {
    id: `${repoFullName}#${number}`,
    repoId: 1,
    repoFullName,
    number,
    title: `Issue ${number}`,
    url: `https://github.example/${repoFullName}/issues/${number}`,
    author: { login: 'bob-contrib', avatarUrl: null, isBot: false },
    labels: [],
    commentCount: 0,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    ...extra
  } satisfies IssueRow
}

const pages: Record<string, ListPage<IssueRow>> = {
  incoming: {
    items: [
      issue('o/a', 45, {
        commentCount: 3,
        labels: [
          { name: 'docs', color: '0075ca' },
          { name: 'meta', color: 'fbca04' },
          { name: 'plain', color: null }
        ]
      })
    ],
    totalCount: 1,
    complete: true
  },
  assigned: { items: [issue('o/a', 44, { commentCount: 1 })], totalCount: 1, complete: true },
  mine: { items: [], totalCount: 0, complete: true }
}

let invoke: ReturnType<typeof vi.fn>

function setup(path: string) {
  invoke = vi.fn((channel: string, req?: { tab?: string }) => {
    if (channel === 'query:issues') return Promise.resolve(pages[req?.tab ?? ''])
    return Promise.resolve({ opened: true })
  })
  window.gdesk = { invoke, on: () => () => {} } as unknown as GdeskApi
  const router = createMemoryRouter(routes, { initialEntries: [path] })
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

describe('IssuesPage', () => {
  it('행: 저장소·번호·제목·작성자·라벨 칩·댓글 수', async () => {
    setup('/issues')
    const row = await screen.findByTestId('issue-row-o/a#45')
    expect(within(row).getByText('Issue 45')).toBeTruthy()
    expect(within(row).getByText('o/a')).toBeTruthy()
    expect(within(row).getByText('#45')).toBeTruthy()
    expect(within(row).getByText('bob-contrib')).toBeTruthy()
    expect(within(row).getByLabelText('3 comments').textContent).toBe('3')

    const docs = row.querySelector<HTMLElement>('[data-label="docs"]')!
    expect(docs.style.backgroundColor).toBe('rgb(0, 117, 202)')
    expect(docs.style.color).toBe('rgb(255, 255, 255)')
    const meta = row.querySelector<HTMLElement>('[data-label="meta"]')!
    expect(meta.style.color).toBe('rgb(0, 0, 0)')
    // 색이 없는 라벨은 중립 배지(인라인 색 없음)
    const plain = row.querySelector<HTMLElement>('[data-label="plain"]')!
    expect(plain.style.backgroundColor).toBe('')
    expect(plain.className).toContain('bg-bg-subtle')
  })

  it('행을 누르면 GitHub 이슈 페이지를 연다', async () => {
    setup('/issues')
    const row = await screen.findByTestId('issue-row-o/a#45')
    fireEvent.click(within(row).getByRole('button', { name: 'o/a#45 Issue 45' }))
    expect(invoke).toHaveBeenCalledWith('app:openExternal', {
      url: 'https://github.example/o/a/issues/45'
    })
  })

  it('탭 ↔ 주소: ?tab=assigned 로 열고, 바꾸면 주소에 남는다', async () => {
    const router = setup('/issues?tab=assigned')
    await screen.findByTestId('issue-row-o/a#44')
    expect(screen.getByRole('tab', { name: /Assigned to me/ }).getAttribute('aria-selected')).toBe(
      'true'
    )
    fireEvent.mouseDown(screen.getByRole('tab', { name: /^Mine/ }), { button: 0 })
    await screen.findByText('No open issues from you')
    expect(router.state.location.search).toBe('?tab=mine')
    expect(invoke).toHaveBeenCalledWith('query:issues', { tab: 'mine' })
  })

  it('한국어 탭 이름', async () => {
    await i18n.changeLanguage('ko')
    setup('/issues')
    await screen.findByTestId('issue-row-o/a#45')
    expect(screen.getByRole('tab', { name: /들어온 이슈/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /나에게 할당/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /내가 올린 이슈/ })).toBeTruthy()
  })
})
