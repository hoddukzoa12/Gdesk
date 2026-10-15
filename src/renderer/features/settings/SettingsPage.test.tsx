// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import type { GdeskApi } from '@shared/ipc/contract'
import type { EditorInfo } from '@shared/domain/local'
import type { Settings, SettingsPatch } from '@shared/domain/settings'
import { i18n } from '@renderer/app/i18n'
import { PreferencesProvider } from '@renderer/app/preferences'
import { SettingsPage } from './SettingsPage'
import { useSettingsPreferencesSource } from './slots'

let stored: Settings
let editors: EditorInfo[]
let invoke: ReturnType<typeof vi.fn>
let listeners: Map<string, (payload: unknown) => void>

function stub(initial: Partial<Settings> = {}): void {
  stored = {
    cloneBaseDir: '/Users/me/GitHub',
    cloneProtocol: 'https',
    defaultEditor: null,
    language: 'en',
    theme: 'light',
    homeCards: [],
    ...initial
  }
  listeners = new Map()
  invoke = vi.fn(async (channel: string, req?: unknown) => {
    switch (channel) {
      case 'settings:get':
        return stored
      case 'settings:update':
        stored = { ...stored, ...(req as SettingsPatch) }
        return stored
      case 'auth:getSession':
        return {
          state: 'signed_in',
          user: { id: 1, login: 'octo', name: null, avatarUrl: '' },
          tokenKind: 'classic',
          missingScopes: [],
          inboxAvailable: true,
          deviceFlowAvailable: false
        }
      case 'local:listEditors':
        return editors
      case 'local:listLinks':
        return []
      case 'query:repositories':
        return { items: [], owners: [] }
      case 'query:starred':
        return []
      case 'app:info':
        return { name: 'Gdesk', version: '1.2.3', platform: 'darwin', testMode: true }
      case 'updater:getStatus':
        return {
          state: 'disabled',
          mode: 'off',
          currentVersion: '1.2.3',
          version: null,
          progress: null,
          checkedAt: null,
          error: null
        }
      default:
        throw new Error(`unexpected ${channel}`)
    }
  })
  window.gdesk = {
    invoke: invoke as unknown as GdeskApi['invoke'],
    on: ((event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    }) as GdeskApi['on']
  }
}

/** 앱 공급자처럼 설정 슬롯의 공급 훅을 PreferencesProvider 에 연결한다. */
function WiredPreferences({ children }: { children: ReactNode }) {
  const source = useSettingsPreferencesSource()
  return (
    <PreferencesProvider value={source?.value} onChange={source?.onChange} osLocale="en-US">
      {children}
    </PreferencesProvider>
  )
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <WiredPreferences>
          <MemoryRouter initialEntries={['/settings']}>
            <SettingsPage />
          </MemoryRouter>
        </WiredPreferences>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

function updates(): SettingsPatch[] {
  return invoke.mock.calls.filter(([ch]) => ch === 'settings:update').map(([, req]) => req)
}

beforeEach(async () => {
  editors = [{ id: 'vscode', name: 'Visual Studio Code' }]
  await i18n.changeLanguage('en')
})
afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe('설정 화면 · 테마·언어 공급', () => {
  it('저장된 테마·언어를 적용하고, 바꾸면 바뀐 키만 저장한다', async () => {
    stub({ theme: 'light', language: 'en' })
    renderPage()
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
    expect(screen.getByTestId('settings-theme-light').getAttribute('aria-checked')).toBe('true')

    fireEvent.click(screen.getByTestId('settings-theme-dark'))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
    expect(updates()).toEqual([{ theme: 'dark' }])

    fireEvent.click(screen.getByTestId('settings-language-ko'))
    await waitFor(() => expect(document.documentElement.lang).toBe('ko'))
    expect(updates()).toEqual([{ theme: 'dark' }, { language: 'ko' }])
    expect(screen.getByTestId('settings-language-ko').getAttribute('aria-checked')).toBe('true')
  })

  it('다른 곳에서 설정이 바뀌면(settings:changed) 따라간다', async () => {
    stub({ theme: 'light' })
    renderPage()
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
    act(() => listeners.get('settings:changed')?.({ ...stored, theme: 'dark' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
  })
})

describe('설정 화면 · 홈 카드', () => {
  it('끄기·옮기기는 아는 카드 다섯 개 전체 목록을 저장한다', async () => {
    stub({ homeCards: [{ id: 'bogus', enabled: false }] })
    renderPage()
    const toggle = await screen.findByTestId('settings-card-failedCi-toggle')
    await waitFor(() =>
      expect(
        (screen.getByTestId('settings-card-starChanges-up') as HTMLButtonElement).disabled
      ).toBe(false)
    )
    fireEvent.click(toggle)
    await waitFor(() => expect(updates()).toHaveLength(1))
    expect(updates()[0]).toEqual({
      homeCards: [
        { id: 'reviewRequests', enabled: true },
        { id: 'unreadNotifications', enabled: true },
        { id: 'failedCi', enabled: false },
        { id: 'unanswered', enabled: true },
        { id: 'starChanges', enabled: true }
      ]
    })

    fireEvent.click(screen.getByTestId('settings-card-starChanges-up'))
    await waitFor(() => expect(updates()).toHaveLength(2))
    expect(updates()[1]?.homeCards?.map((c) => c.id)).toEqual([
      'reviewRequests',
      'unreadNotifications',
      'failedCi',
      'starChanges',
      'unanswered'
    ])
    expect(updates()[1]?.homeCards?.find((c) => c.id === 'failedCi')?.enabled).toBe(false)
  })
})

describe('설정 화면 · 클론', () => {
  it('편집기 선택지와 저장', async () => {
    stub()
    renderPage()
    const select = (await screen.findByTestId('settings-editor')) as HTMLSelectElement
    await waitFor(() => expect(select.options).toHaveLength(2))
    expect([...select.options].map((o) => o.text)).toEqual([
      'None (pick automatically)',
      'Visual Studio Code'
    ])
    fireEvent.change(select, { target: { value: 'vscode' } })
    await waitFor(() => expect(updates()).toEqual([{ defaultEditor: 'vscode' }]))
    fireEvent.change(select, { target: { value: '' } })
    await waitFor(() => expect(updates().at(-1)).toEqual({ defaultEditor: null }))
  })

  it('편집기를 못 찾으면 안내를 보인다', async () => {
    editors = []
    stub()
    renderPage()
    expect(await screen.findByText(/No supported editors were found/)).toBeTruthy()
  })

  it('SSH 를 고르면 cloneProtocol 만 저장한다', async () => {
    stub()
    renderPage()
    await waitFor(() =>
      expect(screen.getByTestId('settings-protocol-https').getAttribute('aria-checked')).toBe(
        'true'
      )
    )
    fireEvent.click(screen.getByTestId('settings-protocol-ssh'))
    await waitFor(() => expect(updates()).toEqual([{ cloneProtocol: 'ssh' }]))
  })
})

describe('설정 화면 · 정보', () => {
  it('버전과 꺼진 업데이트 상태를 보이고 확인 버튼을 끈다', async () => {
    stub()
    renderPage()
    await waitFor(() =>
      expect(screen.getByTestId('settings-app-version').textContent).toBe('Gdesk 1.2.3')
    )
    await waitFor(() =>
      expect(screen.getByTestId('settings-updater-status').textContent).toBe(
        'Updates are off in development and test runs'
      )
    )
    expect((screen.getByTestId('settings-updater-check') as HTMLButtonElement).disabled).toBe(true)
  })
})
