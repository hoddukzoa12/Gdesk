// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, useLocation } from 'react-router'
import type { GdeskApi } from '@shared/ipc/contract'
import type { SessionSnapshot, SessionUser } from '@shared/domain/session'
import { i18n } from '@renderer/app/i18n'
import { AccountMenu } from './AccountMenu'

function session(user: Partial<SessionUser>): SessionSnapshot {
  return {
    state: 'signed_in',
    user: { id: 1, login: 'octo', name: 'Octo Cat', avatarUrl: '', email: null, ...user },
    tokenKind: 'classic',
    missingScopes: [],
    inboxAvailable: true,
    deviceFlowAvailable: true
  }
}

let invoke: ReturnType<typeof vi.fn>

function stub(snapshot: SessionSnapshot): void {
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'auth:getSession') return snapshot
    if (channel === 'auth:logout') return undefined
    return { opened: true }
  })
  const api: GdeskApi = {
    invoke: invoke as unknown as GdeskApi['invoke'],
    on: (() => () => {}) as GdeskApi['on']
  }
  window.gdesk = api
}

function Location() {
  return <span data-testid="location">{useLocation().pathname}</span>
}

function renderMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/home']}>
          <AccountMenu />
          <Location />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

/** Radix 메뉴는 jsdom 에서 키보드로 연다(pointerdown 은 jsdom 에서 불안정) */
async function openMenu(): Promise<void> {
  const trigger = await screen.findByTestId('account-menu-trigger')
  await act(async () => {
    fireEvent.keyDown(trigger, { key: 'Enter' })
  })
}

beforeAll(() => {
  // Radix 위치 계산·포커스가 jsdom 에 없는 API 를 부른다
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

beforeEach(async () => {
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('AccountMenu (사이드바 맨 아래 계정 영역)', () => {
  it('이름과 GitHub 공개 이메일을 보여 준다', async () => {
    stub(session({ email: 'octo@example.dev' }))
    renderMenu()
    expect((await screen.findByTestId('account-name')).textContent).toBe('Octo Cat')
    expect(screen.getByTestId('account-email').textContent).toBe('octo@example.dev')
  })

  it('공개 이메일이 없으면 로그인, 이름이 없으면 로그인을 보여 준다', async () => {
    stub(session({ name: null, email: null }))
    renderMenu()
    expect((await screen.findByTestId('account-name')).textContent).toBe('octo')
    expect(screen.getByTestId('account-email').textContent).toBe('octo')
  })

  it('로그아웃 상태면 아무것도 그리지 않는다', async () => {
    stub({ ...session({}), state: 'signed_out', user: null })
    renderMenu()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('auth:getSession'))
    expect(screen.queryByTestId('account-menu-trigger')).toBeNull()
  })

  it('메뉴는 위로 열리고 설정·프로필·로그아웃 세 항목이다', async () => {
    stub(session({ email: 'octo@example.dev' }))
    renderMenu()
    await openMenu()
    const menu = await screen.findByTestId('account-menu')
    expect(menu.getAttribute('data-side')).toBe('top')
    expect(screen.getAllByRole('menuitem').map((item) => item.dataset.testid)).toEqual([
      'account-menu-settings',
      'account-menu-profile',
      'account-menu-sign-out'
    ])
  })

  it('설정을 누르면 /settings 로 간다', async () => {
    stub(session({}))
    renderMenu()
    await openMenu()
    await act(async () => {
      fireEvent.click(await screen.findByTestId('account-menu-settings'))
    })
    expect(screen.getByTestId('location').textContent).toBe('/settings')
  })

  it('프로필을 누르면 GitHub 프로필을 브라우저로 연다', async () => {
    stub(session({}))
    renderMenu()
    await openMenu()
    await act(async () => {
      fireEvent.click(await screen.findByTestId('account-menu-profile'))
    })
    expect(invoke).toHaveBeenCalledWith('app:openExternal', { url: 'https://github.com/octo' })
  })

  it('로그아웃은 확인한 뒤에만 auth:logout 을 부른다', async () => {
    stub(session({}))
    renderMenu()
    await openMenu()
    await act(async () => {
      fireEvent.click(await screen.findByTestId('account-menu-sign-out'))
    })
    expect(await screen.findByTestId('sign-out-confirm')).toBeTruthy()
    expect(invoke).not.toHaveBeenCalledWith('auth:logout')
    await act(async () => {
      fireEvent.click(screen.getByTestId('sign-out-confirm-button'))
    })
    expect(invoke).toHaveBeenCalledWith('auth:logout')
  })
})
