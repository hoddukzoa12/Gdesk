// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import type { ReactNode } from 'react'
import type { GdeskApi } from '@shared/ipc/contract'
import type { AuthResult, SessionSnapshot } from '@shared/domain/session'
import type { SyncStatus } from '@shared/domain/sync'
import { i18n } from '@renderer/app/i18n'
import { LoginGate } from './LoginGate'
import { OrgRestrictionBanner, SessionExpiredBanner, TokenWarningBanner } from './SessionBanners'
import { StoragePromptDialog } from './StoragePromptDialog'
import { CONNECTIONS_URL } from './messages'

const signedOut: SessionSnapshot = {
  state: 'signed_out',
  user: null,
  tokenKind: null,
  missingScopes: [],
  inboxAvailable: false,
  deviceFlowAvailable: false
}

const signedIn: SessionSnapshot = {
  state: 'signed_in',
  user: { id: 1, login: 'octo', name: 'Octo', avatarUrl: '', email: null },
  tokenKind: 'classic',
  missingScopes: [],
  inboxAvailable: true,
  deviceFlowAvailable: true
}

const syncBase: SyncStatus = {
  connection: 'online',
  lastSyncedAt: null,
  rateLimitedUntil: null,
  syncing: false,
  orgRestrictions: []
}

let invoke: ReturnType<typeof vi.fn>
let emitSession: ((s: SessionSnapshot) => void) | null
let loginResult: AuthResult

function stub(session: SessionSnapshot, sync: SyncStatus = syncBase): void {
  emitSession = null
  invoke = vi.fn(async (channel: string) => {
    switch (channel) {
      case 'auth:getSession':
        return session
      case 'sync:getStatus':
        return sync
      case 'app:info':
        return { name: 'Gdesk', version: '0', platform: 'darwin', testMode: true }
      case 'auth:loginWithToken':
        return loginResult
      case 'auth:startDeviceFlow':
        return { ok: true, session }
      default:
        return { opened: true }
    }
  })
  const api: GdeskApi = {
    invoke: invoke as unknown as GdeskApi['invoke'],
    on: ((event: string, listener: (s: SessionSnapshot) => void) => {
      if (event === 'auth:changed') emitSession = listener
      return () => {}
    }) as GdeskApi['on']
  }
  window.gdesk = api
}

function renderWith(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </I18nextProvider>
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  loginResult = { ok: true, session: signedIn }
})
afterEach(cleanup)

describe('LoginGate', () => {
  it('로그아웃 상태면 로그인 화면을 띄우고 앱 틀을 inert 로 막는다', async () => {
    stub(signedOut)
    renderWith(
      <div>
        <aside data-testid="shell">shell</aside>
        <LoginGate />
      </div>
    )
    expect(await screen.findByTestId('login-screen')).toBeTruthy()
    expect(screen.getByTestId('shell').hasAttribute('inert')).toBe(true)
    // client ID 가 없는 빌드: 브라우저 로그인 숨김, 토큰 입력만
    expect(screen.queryByTestId('device-flow-start')).toBeNull()
    expect(screen.getByLabelText('Personal access token')).toBeTruthy()
    expect(screen.getByText(/Inbox \(notifications\) won’t work/)).toBeTruthy()

    await act(async () => emitSession?.(signedIn))
    await vi.waitFor(() => expect(screen.queryByTestId('login-screen')).toBeNull())
    expect(screen.getByTestId('shell').hasAttribute('inert')).toBe(false)
  })

  it('토큰을 보내면 입력란을 비우고, 실패하면 오류를 보여 준다', async () => {
    stub(signedOut)
    loginResult = { ok: false, error: 'invalid_token', session: signedOut }
    renderWith(<LoginGate />)
    const input = (await screen.findByLabelText('Personal access token')) as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.change(input, { target: { value: 'ghp_bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(input.value).toBe('')
    expect(invoke).toHaveBeenCalledWith('auth:loginWithToken', { token: 'ghp_bad' })
    expect((await screen.findByRole('alert')).textContent).toMatch(/GitHub rejected this token/)
  })

  it('빈 토큰은 보내지 않는다', async () => {
    stub(signedOut)
    renderWith(<LoginGate />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a token.')
    expect(invoke).not.toHaveBeenCalledWith('auth:loginWithToken', expect.anything())
  })

  it('브라우저 코드 로그인: 시작 → 코드 표시 → GitHub 열기·취소', async () => {
    stub({ ...signedOut, deviceFlowAvailable: true })
    renderWith(<LoginGate />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with browser' }))
    expect(invoke).toHaveBeenCalledWith('auth:startDeviceFlow')

    await act(async () =>
      emitSession?.({
        ...signedOut,
        state: 'signing_in',
        deviceFlowAvailable: true,
        deviceFlow: {
          userCode: 'GDSK-1234',
          verificationUri: 'https://github.com/login/device',
          expiresAt: Date.now() + 60_000,
          status: 'pending'
        }
      })
    )
    expect((await screen.findByTestId('device-user-code')).textContent).toBe('GDSK-1234')
    fireEvent.click(screen.getByRole('button', { name: 'Open GitHub' }))
    expect(invoke).toHaveBeenCalledWith('auth:openVerificationUri')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(invoke).toHaveBeenCalledWith('auth:cancelDeviceFlow')

    await act(async () =>
      emitSession?.({
        ...signedOut,
        deviceFlowAvailable: true,
        deviceFlow: { userCode: 'GDSK-1234', verificationUri: '', expiresAt: 0, status: 'expired' }
      })
    )
    expect((await screen.findByTestId('device-flow-status')).textContent).toMatch(/code expired/)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(invoke.mock.calls.filter(([c]) => c === 'auth:startDeviceFlow')).toHaveLength(2)
  })

  it('로그인 상태면 그리지 않는다', async () => {
    stub(signedIn)
    const { container } = renderWith(<LoginGate />)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('auth:getSession'))
    await act(async () => {})
    expect(container.textContent).toBe('')
  })
})

describe('배너', () => {
  it('세션 만료: 다시 로그인을 누를 때만 로그아웃한다', async () => {
    stub({ ...signedIn, state: 'expired' })
    renderWith(<SessionExpiredBanner />)
    expect(await screen.findByText(/session has expired/)).toBeTruthy()
    expect(invoke).not.toHaveBeenCalledWith('auth:logout')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(invoke).toHaveBeenCalledWith('auth:logout')
  })

  it('빠진 권한마다 동작하지 않는 기능을 알리고, 닫을 수 있다', async () => {
    stub({
      ...signedIn,
      missingScopes: [
        { scope: 'repo', impact: 'private_repos_and_star' },
        { scope: 'notifications', impact: 'inbox' }
      ],
      inboxAvailable: false
    })
    renderWith(<TokenWarningBanner />)
    expect(await screen.findByText('Your token is missing some permissions.')).toBeTruthy()
    expect(screen.getByText(/private repositories and starring/)).toBeTruthy()
    expect(screen.getByText(/Inbox is unavailable with this token/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('token-warning-banner')).toBeNull()
  })

  it('세분화 토큰은 Inbox 사용 불가 안내', async () => {
    stub({ ...signedIn, tokenKind: 'fine_grained', inboxAvailable: false })
    renderWith(<TokenWarningBanner />)
    expect(await screen.findByText('Inbox is unavailable with this token.')).toBeTruthy()
    expect(screen.getByText(/Fine-grained tokens can’t read notifications/)).toBeTruthy()
  })

  it('조직 접근 제한: 조직 이름과 설명, 승인 페이지 열기', async () => {
    stub(signedIn, {
      ...syncBase,
      orgRestrictions: [
        { orgLogin: 'gdesk-org', reason: 'oauth_app_restriction', message: '', recordedAt: 0 },
        { orgLogin: 'saml-co', reason: 'saml_enforcement', message: '', recordedAt: 0 }
      ]
    })
    renderWith(<OrgRestrictionBanner />)
    expect(await screen.findByText('gdesk-org')).toBeTruthy()
    expect(screen.getByText('saml-co')).toBeTruthy()
    expect(screen.getByText(/must approve Gdesk/)).toBeTruthy()
    expect(screen.getByText(/SAML single sign-on/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review access' }))
    expect(invoke).toHaveBeenCalledWith('app:openExternal', { url: CONNECTIONS_URL })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('org-restriction-banner')).toBeNull()
  })
})

describe('StoragePromptDialog', () => {
  it('리눅스 약한 저장소 안내에서 고른 값을 보낸다', async () => {
    stub({ ...signedIn, storagePrompt: 'linux_insecure' })
    renderWith(<StoragePromptDialog />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save anyway (owner-only file)' }))
    expect(invoke).toHaveBeenCalledWith('auth:chooseInsecureStorage', { choice: 'save' })
    const memory = screen.getByRole('button', { name: 'Don’t save (sign in every launch)' })
    await vi.waitFor(() => expect((memory as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(memory)
    expect(invoke).toHaveBeenCalledWith('auth:chooseInsecureStorage', { choice: 'memory' })
  })

  it('한국어 문구', async () => {
    await i18n.changeLanguage('ko')
    stub({ ...signedIn, storagePrompt: 'linux_insecure' })
    renderWith(<StoragePromptDialog />)
    expect(await screen.findByText('토큰을 안전하게 저장할 수 없어요')).toBeTruthy()
  })
})
