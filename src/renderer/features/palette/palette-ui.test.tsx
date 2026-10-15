// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, useLocation } from 'react-router'
import type { GdeskApi } from '@shared/ipc/contract'
import type { ConnectionStatus } from '@shared/domain/connection'
import type { GitHubSearchResult, LocalSearchResult } from '@shared/domain/search'
import { i18n } from '@renderer/app/i18n'
import { PreferencesProvider } from '@renderer/app/preferences'
import { closeCloneDialog, requestClone } from '@renderer/features/clone'
import { CommandPalette } from './CommandPalette'
import { closePalette, isPaletteOpen, openPalette } from './store'

vi.mock('@renderer/features/clone', () => ({
  requestClone: vi.fn(),
  closeCloneDialog: vi.fn()
}))

const repo = (id: number, fullName: string) => {
  const [owner, name] = fullName.split('/')
  return { id, owner, name, fullName, description: null, accessStatus: 'available' }
}

const LOCAL: LocalSearchResult = {
  repositories: [repo(101, 'octo/gdesk-demo')],
  pullRequests: [
    {
      id: 'PR_42',
      repoId: 101,
      repoFullName: 'octo/gdesk-demo',
      number: 42,
      title: 'Add parser',
      url: 'https://github.com/octo/gdesk-demo/pull/42'
    }
  ],
  issues: [
    {
      id: 'I_45',
      repoId: 101,
      repoFullName: 'octo/gdesk-demo',
      number: 45,
      title: 'Crash on start',
      url: 'https://github.com/octo/gdesk-demo/issues/45'
    }
  ]
} as never

let invoke: ReturnType<typeof vi.fn>
let connection: ConnectionStatus
let github: GitHubSearchResult

function stub(): void {
  invoke = vi.fn(async (channel: string, req?: { text?: string }) => {
    switch (channel) {
      case 'app:info':
        return { name: 'Gdesk', version: '0', platform: 'linux', testMode: true }
      case 'sync:getStatus':
        return {
          connection,
          lastSyncedAt: null,
          rateLimitedUntil: null,
          syncing: false,
          orgRestrictions: []
        }
      case 'search:local':
        return req?.text?.includes('demo') || req?.text === '#42'
          ? LOCAL
          : { repositories: [], pullRequests: [], issues: [] }
      case 'search:github':
        return github
      case 'query:repositories':
        return { items: [repo(101, 'octo/gdesk-demo'), repo(102, 'octo/dotfiles')], owners: [] }
      case 'settings:update':
        return {}
      case 'app:openExternal':
        return { opened: true }
      default:
        return undefined
    }
  })
  window.gdesk = {
    invoke: invoke as unknown as GdeskApi['invoke'],
    on: (() => () => {}) as GdeskApi['on']
  }
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function renderPalette(path = '/home') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nextProvider i18n={i18n}>
      <PreferencesProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[path]}>
            <CommandPalette debounceMs={0} />
            <Where />
          </MemoryRouter>
        </QueryClientProvider>
      </PreferencesProvider>
    </I18nextProvider>
  )
}

const input = () => screen.getByTestId('palette-input') as HTMLInputElement
const type = (value: string) => fireEvent.change(input(), { target: { value } })
const key = (k: string) => fireEvent.keyDown(input(), { key: k })
const selected = () =>
  screen
    .getAllByRole('option')
    .find((o) => o.getAttribute('aria-selected') === 'true')
    ?.getAttribute('data-testid')

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  connection = 'online'
  github = {
    status: 'ok',
    items: [
      {
        id: 301,
        owner: 'up',
        ownerAvatarUrl: null,
        name: 'awesome-lib',
        fullName: 'up/awesome-lib',
        description: 'An awesome library',
        url: 'https://github.com/up/awesome-lib',
        private: false,
        fork: false,
        archived: false,
        stargazerCount: 250,
        primaryLanguage: null,
        pushedAt: null
      }
    ]
  }
  stub()
})

afterEach(() => {
  act(() => closePalette())
  cleanup()
  vi.mocked(requestClone).mockClear()
  vi.mocked(closeCloneDialog).mockClear()
})

describe('빠른 검색창', () => {
  it('Ctrl+K 로 열고 Esc 로 닫는다(맥이 아니면 ⌘K 는 무시)', async () => {
    renderPalette()
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:info'))
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(screen.queryByTestId('palette')).toBeNull()

    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(await screen.findByTestId('palette')).toBeTruthy()
    expect(document.activeElement).toBe(input())

    fireEvent.keyDown(input(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('palette')).toBeNull())
    expect(isPaletteOpen()).toBe(false)

    // 한글 입력 상태(key 'ㅏ')에서도 물리 키로 연다
    fireEvent.keyDown(window, { key: 'ㅏ', code: 'KeyK', ctrlKey: true })
    expect(await screen.findByTestId('palette')).toBeTruthy()
  })

  it('빈 검색어면 명령 전체, 입력하면 명령을 거른다', async () => {
    renderPalette()
    act(() => openPalette())
    expect(screen.getAllByRole('option')).toHaveLength(16)
    type('inbox')
    expect(screen.getAllByRole('option').map((o) => o.dataset.testid)).toEqual([
      'palette-item-command-go-inbox'
    ])
    key('Enter')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/inbox'))
    expect(screen.queryByTestId('palette')).toBeNull()
  })

  it('↑/↓ 로 옮기고(끝에서 돈다) 마우스로도 고른다', async () => {
    renderPalette()
    act(() => openPalette())
    type('theme')
    expect(selected()).toBe('palette-item-command-theme-dark')
    key('ArrowDown')
    expect(selected()).toBe('palette-item-command-theme-light')
    key('ArrowDown')
    key('ArrowDown')
    expect(selected()).toBe('palette-item-command-theme-dark')
    key('ArrowUp')
    expect(selected()).toBe('palette-item-command-theme-system')
    expect(input().getAttribute('aria-activedescendant')).toBe(
      'palette-option-command-theme-system'
    )
    fireEvent.mouseMove(screen.getByTestId('palette-item-command-theme-light'))
    expect(selected()).toBe('palette-item-command-theme-light')
    fireEvent.click(screen.getByTestId('palette-item-command-theme-light'))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
    expect(invoke).toHaveBeenCalledWith('settings:update', { theme: 'light' })
  })

  it('앱 안 결과는 저장소 → PR → 이슈 → GitHub 순서, 저장소는 상세 화면으로', async () => {
    renderPalette()
    act(() => openPalette())
    type('gdesk-demo')
    await screen.findByTestId('palette-item-repo-101')
    await screen.findByTestId('palette-item-github-301')
    expect(screen.getAllByRole('option').map((o) => o.dataset.testid)).toEqual([
      'palette-item-repo-101',
      'palette-item-pr-PR_42',
      'palette-item-issue-I_45',
      'palette-item-github-301'
    ])
    expect(invoke).toHaveBeenCalledWith('search:local', { text: 'gdesk-demo' })
    expect(invoke).toHaveBeenCalledWith('search:github', { text: 'gdesk-demo' })
    key('Enter')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/repos/101'))
  })

  it('PR 은 브라우저로 연다', async () => {
    renderPalette()
    act(() => openPalette())
    type('#42')
    fireEvent.click(await screen.findByTestId('palette-item-pr-PR_42'))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('app:openExternal', {
        url: 'https://github.com/octo/gdesk-demo/pull/42'
      })
    )
  })

  it('GitHub 결과를 누르면 앱 안 상세 화면으로 간다', async () => {
    renderPalette()
    act(() => openPalette())
    type('awesome')
    fireEvent.click(await screen.findByTestId('palette-item-github-301'))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/repos/301'))
  })

  it('오프라인이면 GitHub 를 부르지 않고 안내를 보이며, 앱 안 검색은 된다', async () => {
    connection = 'offline'
    stub()
    renderPalette()
    act(() => openPalette())
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('sync:getStatus'))
    type('gdesk-demo')
    await screen.findByTestId('palette-item-repo-101')
    expect(screen.getByTestId('palette-note-github').dataset.note).toBe('offline')
    expect(screen.getByTestId('palette-note-github').textContent).toContain('Offline')
    expect(invoke).not.toHaveBeenCalledWith('search:github', expect.anything())
  })

  it.each([
    ['session_expired', 'session_expired', 'Session expired'],
    ['rate_limited', 'api_limited', 'request limit']
  ] as const)(
    '연결이 %s 이면 GitHub 를 부르지 않고 %s 안내를 보인다',
    async (status, note, text) => {
      connection = status
      stub()
      renderPalette()
      act(() => openPalette())
      await waitFor(() => expect(invoke).toHaveBeenCalledWith('sync:getStatus'))
      type('gdesk-demo')
      await screen.findByTestId('palette-item-repo-101')
      const shown = screen.getByTestId('palette-note-github')
      expect(shown.dataset.note).toBe(note)
      expect(shown.textContent).toContain(text)
      await new Promise((r) => setTimeout(r, 10))
      expect(invoke).not.toHaveBeenCalledWith('search:github', expect.anything())
    }
  )

  it('메인이 한도로 거절하면 안내를 보인다', async () => {
    github = { status: 'rate_limited' }
    renderPalette()
    act(() => openPalette())
    type('awesome')
    await waitFor(() =>
      expect(screen.getByTestId('palette-note-github').dataset.note).toBe('rate_limited')
    )
  })

  it('2자 미만이면 검색하지 않는다', async () => {
    renderPalette()
    act(() => openPalette())
    type('g')
    await new Promise((r) => setTimeout(r, 10))
    expect(invoke).not.toHaveBeenCalledWith('search:local', expect.anything())
    expect(invoke).not.toHaveBeenCalledWith('search:github', expect.anything())
    expect(screen.queryByTestId('palette-section-github')).toBeNull()
  })

  it('새로고침은 지금 화면 범위로 부른다', async () => {
    renderPalette('/repos/101')
    act(() => openPalette())
    type('refresh')
    key('Enter')
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('sync:refresh', { scope: 'repo:101' }))
  })

  it('클론: 저장소 고르기로 바뀌고, 고르면 requestClone 을 한 번만 부른다', async () => {
    renderPalette()
    act(() => openPalette())
    type('clone')
    key('Enter')
    expect(screen.getByTestId('palette').dataset.mode).toBe('clone')
    expect(input().value).toBe('')
    await screen.findByTestId('palette-item-clone-102')
    type('dotfiles')
    expect(screen.getAllByRole('option').map((o) => o.dataset.testid)).toEqual([
      'palette-item-clone-102'
    ])
    const target = screen.getByTestId('palette-item-clone-102')
    key('Enter')
    fireEvent.click(target)
    expect(requestClone).toHaveBeenCalledTimes(1)
    expect(requestClone).toHaveBeenCalledWith({ repoId: 102, owner: 'octo', name: 'dotfiles' })
    await waitFor(() => expect(screen.queryByTestId('palette')).toBeNull())
  })

  it('클론 모드에서 빈 입력에 Backspace 면 명령으로 돌아간다', async () => {
    renderPalette()
    act(() => openPalette())
    fireEvent.click(screen.getByTestId('palette-item-command-clone'))
    expect(screen.getByTestId('palette').dataset.mode).toBe('clone')
    key('Backspace')
    expect(screen.getByTestId('palette').dataset.mode).toBe('default')
  })
})
