// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import type { GdeskApi } from '@shared/ipc/contract'
import type { UpdaterStatus } from '@shared/domain/updater'
import { i18n } from '@renderer/app/i18n'
import { UpdaterBanner } from './UpdaterBanner'

const base: UpdaterStatus = {
  state: 'idle',
  mode: 'notify',
  currentVersion: '1.0.0',
  version: null,
  progress: null,
  checkedAt: null,
  error: null
}

let invoke: ReturnType<typeof vi.fn>
let emitStatus: ((status: UpdaterStatus) => void) | null

function stub(initial: UpdaterStatus): void {
  emitStatus = null
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'updater:getStatus') return initial
    if (channel === 'updater:install') return { accepted: true }
    return { opened: true }
  })
  const api: GdeskApi = {
    invoke: invoke as unknown as GdeskApi['invoke'],
    on: ((event: string, listener: (status: UpdaterStatus) => void) => {
      if (event === 'updater:status') emitStatus = listener
      return () => {}
    }) as GdeskApi['on']
  }
  window.gdesk = api
}

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <UpdaterBanner />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('UpdaterBanner', () => {
  it('새 버전 알림(notify)은 다운로드 페이지를 연다', async () => {
    stub({ ...base, state: 'available', version: '1.2.0' })
    renderBanner()
    expect(await screen.findByText('A new version is available')).toBeTruthy()
    expect(screen.getByText(/Gdesk 1\.2\.0 is out/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(invoke).toHaveBeenCalledWith('updater:openDownloadPage')
  })

  it('준비된 업데이트(auto)는 지금 다시 시작한다', async () => {
    stub({ ...base, mode: 'auto', state: 'ready', version: '2.0.0' })
    renderBanner()
    fireEvent.click(await screen.findByRole('button', { name: 'Restart now' }))
    expect(invoke).toHaveBeenCalledWith('updater:install')
  })

  it('다른 상태에서는 그리지 않고, 상태 알림이 오면 나타난다', async () => {
    stub({ ...base, mode: 'auto', state: 'downloading', version: '2.0.0' })
    const { container } = renderBanner()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('updater:getStatus'))
    // 첫 조회 응답이 캐시에 들어갈 때까지 기다린다
    await act(async () => {})
    expect(container.textContent).toBe('')
    expect(emitStatus).not.toBeNull()
    await act(async () => emitStatus?.({ ...base, mode: 'auto', state: 'ready', version: '2.0.0' }))
    expect(await screen.findByText('Update ready')).toBeTruthy()
  })

  it('닫으면 같은 버전에서는 다시 띄우지 않는다', async () => {
    stub({ ...base, state: 'available', version: '1.2.0' })
    renderBanner()
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('A new version is available')).toBeNull()
    await act(async () => emitStatus?.({ ...base, state: 'available', version: '1.3.0' }))
    expect(await screen.findByText(/Gdesk 1\.3\.0 is out/)).toBeTruthy()
  })

  it('한국어 문구', async () => {
    await i18n.changeLanguage('ko')
    stub({ ...base, mode: 'auto', state: 'ready', version: '2.0.0' })
    renderBanner()
    expect(await screen.findByText('업데이트 준비 완료')).toBeTruthy()
    expect(screen.getByRole('button', { name: '지금 다시 시작' })).toBeTruthy()
  })
})
