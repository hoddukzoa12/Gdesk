// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import type { GdeskApi } from '@shared/ipc/contract'
import type { SidebarQueryResult } from '@shared/domain/queries'
import type { SyncStatus } from '@shared/domain/sync'
import { i18n } from '@renderer/app/i18n'
import { OfflineBanner } from './OfflineBanner'
import { PinnedSection } from './PinnedSection'
import { SyncFooter, isRefreshShortcut } from './SyncFooter'

const online: SyncStatus = {
  connection: 'online',
  lastSyncedAt: Date.now() - 30_000,
  rateLimitedUntil: null,
  syncing: false,
  orgRestrictions: []
}

const sidebar: SidebarQueryResult = {
  counts: { unreadNotifications: 6, incomingPullRequests: 6, reviewRequests: 3 },
  pinned: [
    {
      repoId: 101,
      owner: 'octo',
      name: 'gdesk-demo',
      fullName: 'octo/gdesk-demo',
      stargazerCount: 129,
      openPullRequestCount: 4,
      accessStatus: 'available',
      position: 0,
      cached: true
    },
    {
      repoId: 555,
      owner: 'octo',
      name: 'gone',
      fullName: 'octo/gone',
      stargazerCount: 1,
      openPullRequestCount: 0,
      accessStatus: 'unavailable',
      position: 1,
      cached: true
    },
    {
      repoId: 777,
      owner: null,
      name: null,
      fullName: null,
      stargazerCount: null,
      openPullRequestCount: null,
      accessStatus: 'unavailable',
      position: 2,
      cached: false
    }
  ],
  yourRepositories: []
}

let invoke: ReturnType<typeof vi.fn>
const listeners = new Map<string, (payload: unknown) => void>()

function stub(status: SyncStatus, platform = 'linux'): void {
  listeners.clear()
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'sync:getStatus') return status
    if (channel === 'app:info') return { platform }
    if (channel === 'query:sidebar') return sidebar
    if (channel.startsWith('pins:')) return []
    return undefined
  })
  const api: GdeskApi = {
    invoke: invoke as unknown as GdeskApi['invoke'],
    on: ((event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    }) as GdeskApi['on']
  }
  window.gdesk = api
}

function renderAt(path: string, ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('SyncFooter', () => {
  it('상태 문구를 보여 주고 sync:status 알림으로 바뀐다', async () => {
    stub(online)
    renderAt('/home', <SyncFooter />)
    expect(await screen.findByText('Synced 30s ago')).toBeTruthy()
    await act(async () =>
      listeners.get('sync:status')?.({
        ...online,
        connection: 'offline',
        lastSyncedAt: Date.now() - 5 * 60_000
      })
    )
    expect(await screen.findByText(/^Offline · data from [45]m ago$/)).toBeTruthy()
    expect(screen.getByTestId('sync-footer').dataset.connection).toBe('offline')
  })

  it('새로고침 버튼은 지금 화면 범위로 sync:refresh', async () => {
    stub(online)
    renderAt('/starred', <SyncFooter />)
    fireEvent.click(await screen.findByTestId('sync-refresh'))
    expect(invoke).toHaveBeenCalledWith('sync:refresh', { scope: 'starred' })
  })

  it('Ctrl+R 은 기본 동작을 막고 저장소 화면 범위로 새로고침', async () => {
    stub(online, 'linux')
    renderAt('/repos/101', <SyncFooter />)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('app:info'))
    await act(async () => {})
    const event = new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, cancelable: true })
    await act(async () => {
      window.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(invoke).toHaveBeenCalledWith('sync:refresh', { scope: 'repo:101' })
  })

  it('갱신 중이면 스피너', async () => {
    stub({ ...online, syncing: true })
    renderAt('/home', <SyncFooter />)
    expect(await screen.findByText('Syncing…')).toBeTruthy()
  })
})

describe('isRefreshShortcut', () => {
  const key = { key: 'r', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }
  it('맥은 ⌘R, 그 외는 Ctrl+R', () => {
    expect(isRefreshShortcut({ ...key, metaKey: true }, 'darwin')).toBe(true)
    expect(isRefreshShortcut({ ...key, ctrlKey: true }, 'darwin')).toBe(false)
    expect(isRefreshShortcut({ ...key, ctrlKey: true }, 'win32')).toBe(true)
    expect(isRefreshShortcut({ ...key, key: 'R', ctrlKey: true }, 'linux')).toBe(true)
    expect(isRefreshShortcut({ ...key, metaKey: true }, 'linux')).toBe(false)
    expect(isRefreshShortcut({ ...key, ctrlKey: true, shiftKey: true }, 'linux')).toBe(false)
    expect(isRefreshShortcut({ ...key }, 'linux')).toBe(false)
  })
})

describe('OfflineBanner', () => {
  it('오프라인일 때만 보인다', async () => {
    await i18n.changeLanguage('ko')
    stub({ ...online, connection: 'offline', lastSyncedAt: Date.now() - 3 * 60_000 })
    renderAt('/home', <OfflineBanner />)
    const banner = await screen.findByTestId('offline-banner')
    expect(banner.textContent).toMatch(/오프라인 · [23]분 전 정보를 표시하고 있습니다/)
  })

  it('온라인이면 그리지 않는다', async () => {
    stub(online)
    const { container } = renderAt('/home', <OfflineBanner />)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('sync:getStatus'))
    await act(async () => {})
    expect(container.textContent).toBe('')
  })
})

describe('PinnedSection', () => {
  it('이름·스타·PR 수, 사용할 수 없음 + 제거, 아직 받지 않은 자리 표시', async () => {
    stub(online)
    renderAt('/home', <PinnedSection />)
    const row = await screen.findByTestId('pinned-row-101')
    expect(row.textContent).toContain('gdesk-demo')
    expect(row.textContent).toContain('129')
    expect(within(row).getByTestId('sidebar-repo-prs-101').textContent).toContain('4')
    expect(within(row).queryByRole('button', { name: /Remove/ })).toBeNull()

    const gone = screen.getByTestId('pinned-row-555')
    expect(gone.dataset.access).toBe('unavailable')
    expect(within(gone).getByText('Unavailable')).toBeTruthy()
    fireEvent.click(within(gone).getByRole('button', { name: 'Remove gone from Pinned' }))
    expect(invoke).toHaveBeenCalledWith('pins:unpin', { repoId: 555 })

    const pending = screen.getByTestId('pinned-row-777')
    expect(pending.dataset.access).toBe('not_fetched')
    expect(pending.textContent).toContain('#777')
    expect(within(pending).queryByText('Unavailable')).toBeNull()
  })

  it('Alt+↓ 로 순서를 바꿔 pins:reorder', async () => {
    stub(online)
    renderAt('/home', <PinnedSection />)
    const row = await screen.findByTestId('pinned-row-101')
    const button = within(row).getAllByRole('button')[0] as HTMLElement
    fireEvent.keyDown(button, { key: 'ArrowDown', altKey: true })
    expect(invoke).toHaveBeenCalledWith('pins:reorder', { repoIds: [555, 101, 777] })
  })

  it('행 버튼은 숨긴 Alt+↑/↓ 안내를 aria-describedby 로 가리킨다', async () => {
    stub(online)
    renderAt('/home', <PinnedSection />)
    const row = await screen.findByTestId('pinned-row-101')
    const button = within(row).getAllByRole('button')[0] as HTMLElement
    const hint = screen.getByTestId('sidebar-pinned-reorder-hint')
    expect(hint.id).not.toBe('')
    expect(button.getAttribute('aria-describedby')).toBe(hint.id)
    expect(hint.textContent).toBe('Press Alt+Up or Alt+Down to reorder')
  })
})
