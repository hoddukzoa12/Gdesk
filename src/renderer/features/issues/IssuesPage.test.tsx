// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { RouterProvider, createMemoryRouter } from 'react-router'
import type { GdeskApi } from '@shared/ipc/contract'
import type { ActionAvailability } from '@shared/domain/actions'
import type { IssueRow } from '@shared/domain/issue'
import type { IssueDetail, IssueRepoOption } from '@shared/domain/issue-detail'
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
    assignees: [],
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
        createdAt: '2026-10-03T00:00:00Z',
        labels: [
          { name: 'docs', color: '0075ca' },
          { name: 'meta', color: 'fbca04' },
          { name: 'plain', color: null }
        ],
        assignees: [{ login: 'alice', avatarUrl: null, isBot: false }]
      }),
      issue('o/b', 7, { repoId: 2, commentCount: 9, createdAt: '2026-09-01T00:00:00Z' })
    ],
    totalCount: 2,
    complete: true
  },
  assigned: { items: [issue('o/a', 44, { commentCount: 1 })], totalCount: 1, complete: true },
  mentioned: { items: [], totalCount: 0, complete: true },
  mine: { items: [], totalCount: 0, complete: true }
}

function detail(extra: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: 'I_45',
    repoId: 1,
    repoFullName: 'o/a',
    number: 45,
    url: 'https://github.example/o/a/issues/45',
    title: 'Issue 45',
    state: 'open',
    stateReason: null,
    author: { login: 'bob-contrib', avatarUrl: null, isBot: false },
    createdAt: '2026-10-01T00:00:00Z',
    bodyHTML:
      '<p>Body text <a href="https://docs.example/x">docs</a></p><script>window.__t = 1</script>' +
      '<img src="x" onerror="window.__t = 2" alt="broken">',
    labels: [],
    assignees: [],
    reactions: [
      { content: 'THUMBS_UP', count: 3, viewerHasReacted: false },
      { content: 'EYES', count: 1, viewerHasReacted: true }
    ],
    comments: [
      {
        id: 'IC_1',
        author: { login: 'alice', avatarUrl: null, isBot: false },
        createdAt: '2026-10-01T01:00:00Z',
        bodyHTML: '<p>First comment</p>',
        reactions: []
      }
    ],
    commentCount: 1,
    linkedPullRequests: [],
    referencingCommits: [],
    locked: false,
    viewerCanClose: true,
    viewerCanReopen: false,
    viewerCanReact: true,
    viewerPermission: 'ADMIN',
    viewerCanComment: true,
    fetchedAt: 1,
    ...extra
  }
}

const repoOptions: IssueRepoOption[] = [
  {
    repoId: 101,
    owner: 'octo',
    name: 'demo',
    fullName: 'octo/demo',
    ownerAvatarUrl: null,
    private: false,
    hasIssuesEnabled: true,
    viewerPermission: 'ADMIN'
  },
  {
    repoId: 102,
    owner: 'octo',
    name: 'dotfiles',
    fullName: 'octo/dotfiles',
    ownerAvatarUrl: null,
    private: false,
    hasIssuesEnabled: false,
    viewerPermission: 'ADMIN'
  }
]

let invoke: ReturnType<typeof vi.fn>
let responses: Record<string, (req: unknown) => unknown>
let availability: ActionAvailability

function setup(path: string) {
  invoke = vi.fn((channel: string, req?: unknown) => {
    const custom = responses[channel]
    if (custom) return Promise.resolve(custom(req))
    switch (channel) {
      case 'query:issues': {
        const tab = (req as { tab: string }).tab
        return Promise.resolve({
          page: pages[tab],
          counts: { incoming: 2, assigned: 1, mentioned: 0, mine: 0 }
        })
      }
      case 'query:issueDetail':
        return Promise.resolve(detail())
      case 'query:issueRepoOptions':
        return Promise.resolve(repoOptions)
      case 'actions:getAvailability':
        return Promise.resolve(availability)
      case 'sync:getStatus':
        return Promise.resolve({
          connection: 'online',
          lastSyncedAt: null,
          rateLimitedUntil: null,
          syncing: false,
          orgRestrictions: []
        })
      case 'issueActions:repoMeta':
        return Promise.resolve({ ok: true, labels: [], assignees: [] })
      default:
        return Promise.resolve(undefined)
    }
  })
  window.gdesk = { invoke, on: () => () => {} } as unknown as GdeskApi
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  return { router, view }
}

const calls = (channel: string) =>
  invoke.mock.calls.filter(([c]) => c === channel).map(([, req]) => req as unknown)

beforeEach(async () => {
  await i18n.changeLanguage('en')
  responses = {}
  availability = { available: true }
})
afterEach(cleanup)

describe('IssuesPage: 목록', () => {
  it('행: 제목·저장소·번호·라벨 칩·댓글 수', async () => {
    setup('/issues')
    const row = await screen.findByTestId('issue-row-o/a#45')
    expect(within(row).getByText('Issue 45')).toBeTruthy()
    expect(within(row).getByText('o/a')).toBeTruthy()
    expect(within(row).getByText('#45')).toBeTruthy()
    expect(within(row).getByLabelText('3 comments').textContent).toBe('3')

    const docs = row.querySelector<HTMLElement>('[data-label="docs"]')!
    expect(docs.style.backgroundColor).toBe('rgb(0, 117, 202)')
    expect(docs.style.color).toBe('rgb(255, 255, 255)')
    const meta = row.querySelector<HTMLElement>('[data-label="meta"]')!
    expect(meta.style.color).toBe('rgb(0, 0, 0)')
    const plain = row.querySelector<HTMLElement>('[data-label="plain"]')!
    expect(plain.style.backgroundColor).toBe('')
    expect(plain.className).toContain('bg-bg-subtle')
  })

  it('네 탭과 개수 배지', async () => {
    setup('/issues')
    await screen.findByTestId('issue-row-o/a#45')
    expect(screen.getByTestId('issues-count-incoming').textContent).toBe('2')
    expect(screen.getByTestId('issues-count-assigned').textContent).toBe('1')
    expect(screen.getByTestId('issues-count-mentioned').textContent).toBe('0')
    expect(screen.getByTestId('issues-count-mine').textContent).toBe('0')
  })

  it('탭 ↔ 주소: ?tab=assigned 로 열고, 바꾸면 주소에 남는다', async () => {
    const { router } = setup('/issues?tab=assigned')
    await screen.findByTestId('issue-row-o/a#44')
    expect(screen.getByRole('tab', { name: /Assigned to you/ }).getAttribute('aria-selected')).toBe(
      'true'
    )
    fireEvent.mouseDown(screen.getByRole('tab', { name: /^Created/ }), { button: 0 })
    await screen.findByText('No open issues from you')
    expect(router.state.location.search).toBe('?tab=mine')
    expect(invoke).toHaveBeenCalledWith('query:issues', { tab: 'mine' })
  })

  it('필터·정렬은 화면 안에서 적용되고 주소에 남는다', async () => {
    const { router } = setup('/issues')
    await screen.findByTestId('issue-row-o/a#45')
    const order = () =>
      Array.from(document.querySelectorAll('[data-testid^="issue-row-"]')).map((el) =>
        el.getAttribute('data-testid')
      )
    expect(order()).toEqual(['issue-row-o/a#45', 'issue-row-o/b#7'])

    fireEvent.change(screen.getByTestId('issues-sort'), { target: { value: 'comments' } })
    await waitFor(() => expect(order()).toEqual(['issue-row-o/b#7', 'issue-row-o/a#45']))
    expect(router.state.location.search).toBe('?sort=comments')

    fireEvent.change(screen.getByTestId('issues-filter-label'), { target: { value: 'docs' } })
    await waitFor(() => expect(order()).toEqual(['issue-row-o/a#45']))
    fireEvent.change(screen.getByTestId('issues-filter-assignee'), { target: { value: 'alice' } })
    expect(new URLSearchParams(router.state.location.search).get('assignee')).toBe('alice')

    fireEvent.change(screen.getByTestId('issues-filter-repo'), { target: { value: '2' } })
    await screen.findByTestId('list-filtered-empty')
    // 저장소 선택지는 현재 탭 목록에서
    const repoOptionsShown = Array.from(
      screen.getByTestId('issues-filter-repo').querySelectorAll('option')
    ).map((o) => o.textContent)
    expect(repoOptionsShown).toEqual(['All repositories', 'o/a', 'o/b'])
  })

  it('한국어 탭 이름', async () => {
    await i18n.changeLanguage('ko')
    setup('/issues')
    await screen.findByTestId('issue-row-o/a#45')
    expect(screen.getByRole('tab', { name: /들어온 이슈/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /나에게 할당/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /멘션/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /내가 올린 이슈/ })).toBeTruthy()
    expect(screen.getByText('이슈를 선택하세요')).toBeTruthy()
  })
})

describe('IssuesPage: 상세 패널', () => {
  it('행을 누르면 패널을 열고 주소·상세 추적을 알린다(앱 창은 이동하지 않는다)', async () => {
    const { router } = setup('/issues')
    const row = await screen.findByTestId('issue-row-o/a#45')
    fireEvent.click(within(row).getByRole('button', { name: 'o/a#45 Issue 45' }))
    expect(await screen.findByTestId('issue-title')).toBeTruthy()
    expect(router.state.location.search).toBe('?issue=1-45')
    expect(calls('sync:setViewedIssue')).toContainEqual({ repoId: 1, number: 45 })
    expect(invoke).not.toHaveBeenCalledWith('app:openExternal', expect.anything())
    expect(screen.getByTestId('issue-row-o/a#45').getAttribute('data-selected')).toBe('true')
  })

  it('본문은 정리해서 넣고, 링크는 브라우저로 연다', async () => {
    setup('/issues?issue=1-45')
    const body = await screen.findByTestId('issue-body')
    expect(body.textContent).toContain('Body text')
    expect(body.querySelector('script')).toBeNull()
    expect(body.querySelector('[onerror]')).toBeNull()
    fireEvent.click(within(body).getByText('docs'))
    expect(invoke).toHaveBeenCalledWith('app:openExternal', { url: 'https://docs.example/x' })
  })

  it('패널을 닫으면(언마운트) 상세 추적을 끝낸다', async () => {
    const { view } = setup('/issues?issue=1-45')
    await screen.findByTestId('issue-title')
    view.unmount()
    expect(calls('sync:setViewedIssue').at(-1)).toBeNull()
  })

  it('반응 칩을 누르면 내 반응을 켜고 끈다', async () => {
    responses['issueActions:react'] = () => ({ ok: true })
    setup('/issues?issue=1-45')
    const bar = await screen.findByTestId('issue-reactions')
    const eyes = await waitFor(() => {
      const el = bar.querySelector<HTMLButtonElement>('[data-content="EYES"]')
      expect(el?.disabled).toBe(false)
      return el!
    })
    fireEvent.click(eyes)
    await waitFor(() =>
      expect(calls('issueActions:react')).toEqual([
        { subjectId: 'I_45', issueRef: { repoId: 1, number: 45 }, content: 'EYES', add: false }
      ])
    )
    fireEvent.click(bar.querySelector<HTMLButtonElement>('[data-content="THUMBS_UP"]')!)
    await waitFor(() =>
      expect(calls('issueActions:react').at(-1)).toEqual({
        subjectId: 'I_45',
        issueRef: { repoId: 1, number: 45 },
        content: 'THUMBS_UP',
        add: true
      })
    )
  })

  it('반응 실패는 오류를 보인다', async () => {
    responses['issueActions:react'] = () => ({ ok: false, reason: 'failed', message: 'boom' })
    setup('/issues?issue=1-45')
    const bar = await screen.findByTestId('issue-reactions')
    await waitFor(() =>
      expect(bar.querySelector<HTMLButtonElement>('[data-content="EYES"]')?.disabled).toBe(false)
    )
    fireEvent.click(bar.querySelector<HTMLButtonElement>('[data-content="EYES"]')!)
    expect((await screen.findByTestId('issue-action-error')).textContent).toContain('boom')
  })

  it('반응을 허락하지 않으면 반응 버튼을 숨긴다', async () => {
    responses['query:issueDetail'] = () => detail({ viewerCanReact: false })
    setup('/issues?issue=1-45')
    const bar = await screen.findByTestId('issue-reactions')
    expect(bar.querySelector('button')).toBeNull()
    expect(screen.queryByTestId('reaction-picker-button')).toBeNull()
    expect(bar.querySelector('[data-content="THUMBS_UP"]')?.getAttribute('data-count')).toBe('3')
  })

  it('댓글 실패: 글을 그대로 두고 오류를 보인다. 성공하면 비운다', async () => {
    responses['issueActions:comment'] = () => ({
      ok: false,
      reason: 'failed',
      message: 'GitHub said no'
    })
    setup('/issues?issue=1-45')
    const input = (await screen.findByTestId('comment-input')) as HTMLTextAreaElement
    const submit = screen.getByTestId('comment-submit') as HTMLButtonElement
    await waitFor(() => expect(submit.disabled).toBe(true)) // 빈 글
    fireEvent.change(input, { target: { value: 'Hello **there**' } })
    await waitFor(() => expect(submit.disabled).toBe(false))
    fireEvent.click(submit)
    expect((await screen.findByTestId('comment-error')).textContent).toContain('GitHub said no')
    expect((screen.getByTestId('comment-input') as HTMLTextAreaElement).value).toBe(
      'Hello **there**'
    )
    expect(calls('issueActions:comment')).toEqual([
      { issueRef: { repoId: 1, number: 45 }, body: 'Hello **there**' }
    ])

    responses['issueActions:comment'] = () => ({ ok: true })
    fireEvent.click(screen.getByTestId('comment-submit'))
    await waitFor(() =>
      expect((screen.getByTestId('comment-input') as HTMLTextAreaElement).value).toBe('')
    )
    expect(screen.queryByTestId('comment-error')).toBeNull()
  })

  it('댓글을 달 수 없는 이슈는 입력란 대신 안내', async () => {
    responses['query:issueDetail'] = () =>
      detail({ locked: true, viewerCanComment: false, viewerCanClose: false })
    setup('/issues?issue=1-45')
    expect(await screen.findByTestId('comment-locked-notice')).toBeTruthy()
    expect(screen.queryByTestId('comment-input')).toBeNull()
    expect(screen.queryByTestId('issue-close-button')).toBeNull()
  })

  it('오프라인이면 쓰기 버튼을 끄고 이유를 보인다', async () => {
    availability = { available: false, reason: 'offline' }
    setup('/issues?issue=1-45')
    expect(await screen.findByTestId('issue-blocked-hint')).toBeTruthy()
    const input = screen.getByTestId('comment-input')
    fireEvent.change(input, { target: { value: 'x' } })
    expect((screen.getByTestId('comment-submit') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('issue-close-button') as HTMLButtonElement).disabled).toBe(true)
    const picker = within(screen.getByTestId('issue-reactions')).getByTestId(
      'reaction-picker-button'
    )
    expect((picker as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('new-issue-button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('받은 적 없는 상세 + 오프라인 → 불러올 수 없음 안내', async () => {
    responses['query:issueDetail'] = () => null
    responses['sync:getStatus'] = () => ({
      connection: 'offline',
      lastSyncedAt: null,
      rateLimitedUntil: null,
      syncing: false,
      orgRestrictions: []
    })
    setup('/issues?issue=1-45')
    const el = await screen.findByTestId('issue-detail-unavailable')
    expect(el.getAttribute('data-connection')).toBe('offline')
    expect(el.textContent).toContain('Can’t load while offline')
  })

  it('온라인인데 15초 동안 상세가 오지 않으면 실패 안내 · 다시 시도 · GitHub에서 열기', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      responses['query:issueDetail'] = () => null
      setup('/issues?issue=1-45')
      await screen.findByTestId('issue-detail-loading')
      await waitFor(() => expect(calls('sync:getStatus').length).toBeGreaterThan(0))
      await act(async () => {})

      await act(async () => {
        vi.advanceTimersByTime(14_000)
      })
      expect(screen.getByTestId('issue-detail-loading')).toBeTruthy()
      expect(screen.queryByTestId('issue-detail-failed')).toBeNull()
      await act(async () => {
        vi.advanceTimersByTime(1_500)
      })
      const failed = await screen.findByTestId('issue-detail-failed')
      expect(failed.textContent).toContain('Couldn’t load this issue')

      // GitHub에서 열기: 목록 행의 주소
      fireEvent.click(screen.getByTestId('issue-detail-open-github'))
      expect(invoke).toHaveBeenCalledWith('app:openExternal', {
        url: 'https://github.example/o/a/issues/45'
      })

      // 다시 시도: 상세 추적을 닫았다가 같은 이슈로 다시 알린다(메인은 같은 이슈 재알림을 무시)
      const before = calls('sync:setViewedIssue').length
      fireEvent.click(screen.getByTestId('issue-detail-retry'))
      await waitFor(() =>
        expect(calls('sync:setViewedIssue').slice(before)).toEqual([
          null,
          { repoId: 1, number: 45 }
        ])
      )
      expect(screen.getByTestId('issue-detail-loading')).toBeTruthy()
      // 다시 기다린다
      await act(async () => {
        vi.advanceTimersByTime(15_500)
      })
      expect(await screen.findByTestId('issue-detail-failed')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('받은 적 없는 상세 + 온라인 → 불러오는 중', async () => {
    responses['query:issueDetail'] = () => null
    setup('/issues?issue=1-45')
    expect(await screen.findByTestId('issue-detail-loading')).toBeTruthy()
  })
})

describe('새 이슈 대화상자', () => {
  it('이슈 기능이 꺼진 저장소는 보이지만 고를 수 없다', async () => {
    setup('/issues')
    const button = await screen.findByTestId('new-issue-button')
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(button)
    const dotfiles = await screen.findByTestId('new-issue-repo-102')
    expect(dotfiles.getAttribute('aria-disabled')).toBe('true')
    expect(dotfiles.textContent).toContain('Issues are turned off')
    fireEvent.click(dotfiles)
    expect(dotfiles.getAttribute('aria-selected')).toBe('false')
    expect(screen.queryByTestId('new-issue-selected-repo')).toBeNull()
    expect(calls('issueActions:repoMeta')).toEqual([])

    // 검색
    fireEvent.change(screen.getByTestId('new-issue-repo-search'), { target: { value: 'dem' } })
    expect(screen.queryByTestId('new-issue-repo-102')).toBeNull()
    fireEvent.click(screen.getByTestId('new-issue-repo-101'))
    expect(screen.getByTestId('new-issue-repo-101').getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(calls('issueActions:repoMeta')).toEqual([{ repoId: 101 }]))
  })

  it('만들기 실패는 양식을 두고, 성공하면 내가 올린 이슈 탭에서 연다', async () => {
    responses['issueActions:create'] = () => ({ ok: false, reason: 'failed', message: 'nope' })
    const { router } = setup('/issues?label=docs')
    const button = await screen.findByTestId('new-issue-button')
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(button)
    fireEvent.click(await screen.findByTestId('new-issue-repo-101'))
    const submit = screen.getByTestId('new-issue-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true) // 제목 없음
    fireEvent.change(screen.getByTestId('new-issue-title'), { target: { value: 'New bug' } })
    await waitFor(() => expect(submit.disabled).toBe(false))
    fireEvent.click(submit)
    expect((await screen.findByTestId('new-issue-error')).textContent).toContain('nope')
    expect((screen.getByTestId('new-issue-title') as HTMLInputElement).value).toBe('New bug')

    responses['issueActions:create'] = () => ({
      ok: true,
      issue: { repoId: 101, number: 46, nodeId: 'I_46' }
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('new-issue-submit'))
    })
    await waitFor(() => expect(screen.queryByTestId('new-issue-dialog')).toBeNull())
    expect(router.state.location.search).toBe('?tab=mine&issue=101-46')
    expect(calls('issueActions:create').at(-1)).toEqual({ repoId: 101, title: 'New bug' })
  })
})
