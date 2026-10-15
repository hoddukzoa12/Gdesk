// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import type { GdeskApi } from '@shared/ipc/contract'
import { i18n } from '@renderer/app/i18n'
import { CrashBoundary } from './CrashBoundary'

let invoke: ReturnType<typeof vi.fn>
let shouldThrow = true

function Bomb() {
  if (shouldThrow) throw new Error('bomb')
  return <p>fine</p>
}

beforeEach(async () => {
  shouldThrow = true
  invoke = vi.fn(async () => ({ accepted: true }))
  window.gdesk = { invoke, on: () => () => {} } as unknown as GdeskApi
  await i18n.changeLanguage('en')
  // React 가 잡힌 오류를 콘솔에 남기는 것을 조용히 한다
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CrashBoundary', () => {
  it('자식이 렌더 중 던지면 대체 화면을 그리고 메인에 보고한다', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <CrashBoundary>
          <Bomb />
        </CrashBoundary>
      </I18nextProvider>
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(invoke).toHaveBeenCalledWith(
      'crash:reportRenderer',
      expect.objectContaining({ message: 'Error: bomb' })
    )
    shouldThrow = false
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })))
    expect(screen.getByText('fine')).toBeTruthy()
  })
})
