// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import type { GdeskApi } from '@shared/ipc/contract'
import type { ActionAvailability } from '@shared/domain/actions'
import type { LocalLink } from '@shared/domain/link'
import type { CloneOutcome } from '@shared/domain/local'
import { i18n } from '@renderer/app/i18n'
import { CloneDialog } from './CloneDialog'
import { CloneOpenMenu } from './CloneMenu'
import { closeCloneDialog, requestClone } from './store'

const SETTINGS = {
  cloneBaseDir: '/Users/me/GitHub',
  cloneProtocol: 'https',
  defaultEditor: null,
  language: 'system',
  theme: 'system',
  homeCards: []
}

interface StubOptions {
  links?: LocalLink[]
  availability?: ActionAvailability
  cloneOutcome?: CloneOutcome
}

let invoke: ReturnType<typeof vi.fn>

function stub({
  links = [],
  availability = { available: true },
  cloneOutcome = { kind: 'cancelled' }
}: StubOptions = {}): void {
  invoke = vi.fn(async (channel: string) => {
    switch (channel) {
      case 'local:listLinks':
        return links
      case 'local:listEditors':
        return [{ id: 'vscode', name: 'Visual Studio Code' }]
      case 'settings:get':
        return SETTINGS
      case 'app:info':
        return { name: 'Gdesk', version: '0', platform: 'darwin', testMode: true }
      case 'actions:getAvailability':
        return availability
      case 'local:clone':
        return cloneOutcome
      default:
        return undefined
    }
  })
  const api: GdeskApi = {
    invoke: invoke as unknown as GdeskApi['invoke'],
    on: (() => () => {}) as GdeskApi['on']
  }
  window.gdesk = api
}

function renderWith(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

const link: LocalLink = {
  id: 7,
  repoId: 101,
  path: '/Users/me/GitHub/gdesk-demo',
  lastUsedAt: 1,
  status: 'ok'
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  act(() => closeCloneDialog())
  cleanup()
})

describe('Clone/Open 메뉴 버튼', () => {
  it('연결이 없으면 Clone', async () => {
    stub({ links: [] })
    renderWith(<CloneOpenMenu repoId={101} owner="octo" name="gdesk-demo" />)
    const button = screen.getByTestId('repo-clone-button')
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('local:listLinks', { repoId: 101 }))
    expect(button).toHaveProperty('textContent', 'Clone')
    expect(button.getAttribute('data-mode')).toBe('clone')
  })

  it('연결이 있으면 Open', async () => {
    stub({ links: [link] })
    renderWith(<CloneOpenMenu repoId={101} owner="octo" name="gdesk-demo" />)
    const button = screen.getByTestId('repo-clone-button')
    await waitFor(() => expect(button.getAttribute('data-mode')).toBe('open'))
    expect(button.textContent).toBe('Open')
  })
})

describe('클론 대화상자', () => {
  it('requestClone 으로 열리고 기본 대상 경로를 보여 준다', async () => {
    stub()
    renderWith(<CloneDialog />)
    expect(screen.queryByTestId('clone-dialog')).toBeNull()
    act(() => requestClone({ repoId: 101, owner: 'octo', name: 'gdesk-demo' }))
    expect(screen.getByTestId('clone-dialog')).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByTestId('clone-target-path').textContent).toBe(
        '/Users/me/GitHub/gdesk-demo'
      )
    )
    expect(screen.getByTestId('clone-protocol').textContent).toBe('HTTPS')
    await waitFor(() =>
      expect((screen.getByTestId('clone-start') as HTMLButtonElement).disabled).toBe(false)
    )
  })

  it('오프라인이면 시작 버튼을 끄고 이유를 보여 준다', async () => {
    stub({ availability: { available: false, reason: 'offline' } })
    renderWith(<CloneDialog />)
    act(() => requestClone({ repoId: 101, owner: 'octo', name: 'gdesk-demo' }))
    await waitFor(() => expect(screen.getByTestId('clone-blocked-reason')).toBeTruthy())
    expect((screen.getByTestId('clone-start') as HTMLButtonElement).disabled).toBe(true)
  })

  it('클론이 끝나면 성공 상태와 편집기 열기 버튼', async () => {
    stub({ cloneOutcome: { kind: 'cloned', path: link.path, link } })
    renderWith(<CloneDialog />)
    act(() => requestClone({ repoId: 101, owner: 'octo', name: 'gdesk-demo' }))
    const start = screen.getByTestId('clone-start') as HTMLButtonElement
    await waitFor(() => expect(start.disabled).toBe(false))
    fireEvent.click(start)
    await waitFor(() => expect(screen.getByTestId('clone-success')).toBeTruthy())
    expect(screen.getByTestId('clone-open-editor')).toBeTruthy()
    const call = invoke.mock.calls.find((c) => c[0] === 'local:clone')
    // 대상을 바꾸지 않았으면 targetDir 를 넘기지 않는다(메인 기본값과 같다)
    expect(call?.[1]).toMatchObject({ repoId: 101, owner: 'octo', name: 'gdesk-demo' })
    expect(call?.[1]).not.toHaveProperty('targetDir')
  })

  it('같은 저장소 폴더가 이미 있으면 "이 폴더 연결"을 제안한다', async () => {
    stub({ cloneOutcome: { kind: 'exists', path: link.path, remotes: [], sameRepo: true } })
    renderWith(<CloneDialog />)
    act(() => requestClone({ repoId: 101, owner: 'octo', name: 'gdesk-demo' }))
    const start = screen.getByTestId('clone-start') as HTMLButtonElement
    await waitFor(() => expect(start.disabled).toBe(false))
    fireEvent.click(start)
    await waitFor(() => expect(screen.getByTestId('clone-link-folder')).toBeTruthy())
  })

  it('실패하면 코드별 문구와 원문', async () => {
    stub({ cloneOutcome: { kind: 'failed', code: 'not_found', detail: 'remote: Not Found' } })
    renderWith(<CloneDialog />)
    act(() => requestClone({ repoId: 101, owner: 'octo', name: 'gdesk-demo' }))
    const start = screen.getByTestId('clone-start') as HTMLButtonElement
    await waitFor(() => expect(start.disabled).toBe(false))
    fireEvent.click(start)
    await waitFor(() => expect(screen.getByTestId('clone-failed')).toBeTruthy())
    expect(screen.getByTestId('clone-failed').textContent).toContain(
      i18n.t('cloneFailure.not_found', { ns: 'clone' })
    )
    expect(screen.getByTestId('clone-failure-detail').textContent).toBe('remote: Not Found')
  })

  it('취소되면 닫힌다', async () => {
    stub({ cloneOutcome: { kind: 'cancelled' } })
    renderWith(<CloneDialog />)
    act(() => requestClone({ repoId: 101, owner: 'octo', name: 'gdesk-demo' }))
    const start = screen.getByTestId('clone-start') as HTMLButtonElement
    await waitFor(() => expect(start.disabled).toBe(false))
    fireEvent.click(start)
    await waitFor(() => expect(screen.queryByTestId('clone-dialog')).toBeNull())
  })
})
