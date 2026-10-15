// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import type { GdeskApi } from '@shared/ipc/contract'
import type { ActionAvailability, ActionResult } from '@shared/domain/actions'
import type { InboxQueryResult } from '@shared/domain/queries'
import type { NotificationRow } from '@shared/domain/notification'
import { i18n } from '@renderer/app/i18n'
import { InboxPage } from './InboxPage'

function row(
  threadId: string,
  state: NotificationRow['state'],
  reason: string,
  repoFullName: string
): NotificationRow {
  return {
    threadId,
    state,
    reason,
    subjectTitle: `Title ${threadId}`,
    subjectType: 'Issue',
    url: `https://github.com/${repoFullName}/issues/${threadId}`,
    repoId: 1,
    repoFullName,
    updatedAt: new Date(Date.now() - 3600_000).toISOString()
  }
}

const ITEMS: NotificationRow[] = [
  row('1', 'unread', 'review_requested', 'o/a'),
  row('2', 'unread', 'mention', 'o/b'),
  row('3', 'read', 'weird_new_reason', 'o/a')
]

let invoke: ReturnType<typeof vi.fn>
let emitAvailability: ((a: ActionAvailability) => void) | null
let inbox: InboxQueryResult
let availability: ActionAvailability
let markReadResult: ActionResult
let markDoneResult: ActionResult

function stub(): void {
  emitAvailability = null
  invoke = vi.fn(async (channel: string) => {
    switch (channel) {
      case 'query:inbox':
        return inbox
      case 'actions:getAvailability':
        return availability
      case 'actions:markRead':
        return markReadResult
      case 'actions:markDone':
        return markDoneResult
      case 'app:openExternal':
        return { opened: true }
      default:
        throw new Error(`unexpected ${channel}`)
    }
  })
  window.gdesk = {
    invoke: invoke as unknown as GdeskApi['invoke'],
    on: ((event: string, listener: (a: ActionAvailability) => void) => {
      if (event === 'actions:availability') emitAvailability = listener
      return () => {}
    }) as GdeskApi['on']
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <InboxPage />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

function calls(channel: string): unknown[][] {
  return invoke.mock.calls.filter((c) => c[0] === channel)
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  inbox = { items: ITEMS, complete: true, inboxAvailable: true }
  availability = { available: true }
  markReadResult = { ok: true }
  markDoneResult = { ok: true }
  stub()
})
afterEach(cleanup)

async function ready(): Promise<void> {
  await screen.findByTestId('inbox-row-1')
  await vi.waitFor(() => expect(calls('actions:getAvailability')).toHaveLength(1))
  await act(async () => {})
}

describe('InboxPage', () => {
  it('행을 그리고 사유 문구를 번역(모르는 사유는 대체 문구)한다', async () => {
    renderPage()
    await ready()
    expect(screen.getByTestId('inbox-row-1').dataset.state).toBe('unread')
    expect(screen.getByTestId('inbox-row-3').dataset.state).toBe('read')
    expect(within(screen.getByTestId('inbox-row-1')).getByText('Review requested')).toBeTruthy()
    expect(within(screen.getByTestId('inbox-row-3')).getByText('Weird new reason')).toBeTruthy()
    expect(within(screen.getByTestId('inbox-row-1')).getByText('o/a')).toBeTruthy()
    // 안 읽은 행은 접근성 이름에 상태를 앞에 붙인다
    expect(screen.getByRole('button', { name: 'Unread: Title 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Title 3' })).toBeTruthy()
  })

  it('안 읽음 탭·저장소·사유 필터', async () => {
    renderPage()
    await ready()
    fireEvent.mouseDown(screen.getByTestId('inbox-filter-unread'))
    expect(screen.queryByTestId('inbox-row-3')).toBeNull()
    expect(screen.getByTestId('inbox-row-2')).toBeTruthy()

    fireEvent.change(screen.getByTestId('inbox-filter-repo'), { target: { value: 'o/a' } })
    expect(screen.queryByTestId('inbox-row-2')).toBeNull()
    expect(screen.getByTestId('inbox-row-1')).toBeTruthy()

    fireEvent.mouseDown(screen.getByTestId('inbox-filter-all'))
    fireEvent.change(screen.getByTestId('inbox-filter-reason'), {
      target: { value: 'weird_new_reason' }
    })
    expect(screen.queryByTestId('inbox-row-1')).toBeNull()
    expect(screen.getByTestId('inbox-row-3')).toBeTruthy()
  })

  it('안 읽은 행을 누르면 페이지를 열고 읽음 처리한다', async () => {
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Unread: Title 1' }))
    await vi.waitFor(() =>
      expect(calls('actions:markRead')).toEqual([['actions:markRead', { threadId: '1' }]])
    )
    expect(calls('app:openExternal')).toEqual([
      ['app:openExternal', { url: 'https://github.com/o/a/issues/1' }]
    ])
  })

  it('읽은 행은 열기만 한다', async () => {
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Title 3' }))
    await vi.waitFor(() => expect(calls('app:openExternal')).toHaveLength(1))
    await act(async () => {})
    expect(calls('actions:markRead')).toHaveLength(0)
  })

  it('읽음 처리 실패를 행 안에 알린다', async () => {
    markReadResult = { ok: false, reason: 'failed', message: 'Server error' }
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Unread: Title 1' }))
    const error = await screen.findByTestId('inbox-error-1')
    expect(error.textContent).toContain('Server error')
  })

  it('완료 버튼은 markDone 을 부르고, 실패하면 오류를 보여 준다', async () => {
    markDoneResult = { ok: false, reason: 'failed', message: 'Nope' }
    renderPage()
    await ready()
    fireEvent.click(screen.getByTestId('inbox-done-2'))
    await vi.waitFor(() =>
      expect(calls('actions:markDone')).toEqual([['actions:markDone', { threadId: '2' }]])
    )
    expect((await screen.findByTestId('inbox-error-2')).textContent).toContain('Nope')
  })

  it('쓰기를 못 하면 완료 버튼을 끄고 이유를 보이며, 눌러도 열기만 한다', async () => {
    availability = { available: false, reason: 'offline' }
    renderPage()
    await ready()
    expect((screen.getByTestId('inbox-done-1') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('inbox-blocked-hint').textContent).toMatch(/offline/i)
    fireEvent.click(screen.getByRole('button', { name: 'Unread: Title 1' }))
    await vi.waitFor(() => expect(calls('app:openExternal')).toHaveLength(1))
    await act(async () => {})
    expect(calls('actions:markRead')).toHaveLength(0)

    // 다시 온라인이 되면 이벤트로 버튼이 켜진다
    // (조회 캐시 알림은 react-query 가 다음 차례에 화면에 반영한다)
    await act(async () => emitAvailability?.({ available: true }))
    await vi.waitFor(() =>
      expect((screen.getByTestId('inbox-done-1') as HTMLButtonElement).disabled).toBe(false)
    )
    expect(screen.queryByTestId('inbox-blocked-hint')).toBeNull()
  })

  it('알림을 받을 수 없는 토큰이면 목록 대신 안내를 보인다', async () => {
    inbox = { items: [], complete: true, inboxAvailable: false }
    renderPage()
    expect((await screen.findByTestId('inbox-unavailable')).textContent).toContain(
      'This token can’t access GitHub notifications. Use a classic token or browser sign-in.'
    )
    expect(screen.queryByTestId('inbox-empty')).toBeNull()
  })

  it('비어 있으면 All caught up', async () => {
    inbox = { items: [], complete: true, inboxAvailable: true }
    renderPage()
    expect((await screen.findByTestId('inbox-empty')).textContent).toContain('All caught up')
  })

  it('목록이 다 오지 않았으면 GitHub 알림 페이지 링크를 보인다', async () => {
    inbox = { items: ITEMS, complete: false, inboxAvailable: true }
    renderPage()
    await ready()
    const more = screen.getByTestId('inbox-more')
    fireEvent.click(within(more).getByRole('link', { name: /More on GitHub/ }))
    expect(calls('app:openExternal')).toEqual([
      ['app:openExternal', { url: 'https://github.com/notifications' }]
    ])
  })

  it('한국어 문구', async () => {
    await i18n.changeLanguage('ko')
    renderPage()
    await ready()
    expect(within(screen.getByTestId('inbox-row-2')).getByText('멘션')).toBeTruthy()
    expect(screen.getByTestId('inbox-done-1').textContent).toContain('완료')
  })
})
