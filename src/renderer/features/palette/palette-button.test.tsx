// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import type { GdeskApi } from '@shared/ipc/contract'
import { i18n } from '@renderer/app/i18n'
import { PaletteButton, SEARCH_COLLAPSE_WIDTH } from './PaletteButton'
import { closePalette, isPaletteOpen } from './store'

/** jsdom 에는 matchMedia 가 없다. 창 너비를 흉내 내고 change 알림을 보낸다. */
let width = 1280
const mediaListeners = new Set<() => void>()

function setWidth(next: number): void {
  width = next
  for (const listener of mediaListeners) listener()
}

function stubMatchMedia(): void {
  window.matchMedia = ((query: string) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity)
    return {
      get matches() {
        return width <= max
      },
      media: query,
      addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener)
    }
  }) as unknown as typeof window.matchMedia
}

function stub(platform: 'darwin' | 'linux'): void {
  const api: GdeskApi = {
    invoke: vi.fn(async () => ({
      name: 'Gdesk',
      version: '0',
      platform,
      testMode: true
    })) as unknown as GdeskApi['invoke'],
    on: (() => () => {}) as GdeskApi['on']
  }
  window.gdesk = api
}

function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <PaletteButton />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

beforeEach(async () => {
  width = 1280
  mediaListeners.clear()
  stubMatchMedia()
  stub('linux')
  closePalette()
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('PaletteButton (상단 막대 검색 입력)', () => {
  it('넓은 창에서는 입력 모양으로 문구와 단축키를 보이고, 누르면 빠른 검색창을 연다', async () => {
    renderButton()
    const button = screen.getByTestId('palette-open-button')
    expect(button.dataset.collapsed).toBe('false')
    expect(button.textContent).toContain('Search repositories, issues, pull requests…')
    expect(button.textContent).toContain('Ctrl')
    fireEvent.click(button)
    expect(isPaletteOpen()).toBe(true)
  })

  it('한국어 문구', async () => {
    await i18n.changeLanguage('ko')
    renderButton()
    expect(screen.getByTestId('palette-open-button').textContent).toContain(
      '저장소, 이슈, PR 검색…'
    )
  })

  it(`창이 ${SEARCH_COLLAPSE_WIDTH}px 보다 좁으면 돋보기 아이콘 버튼으로 접히고, 넓어지면 펴진다`, async () => {
    renderButton()
    expect(screen.getByTestId('palette-open-button').dataset.collapsed).toBe('false')

    act(() => setWidth(SEARCH_COLLAPSE_WIDTH - 1))
    const collapsed = screen.getByTestId('palette-open-button')
    expect(collapsed.dataset.collapsed).toBe('true')
    expect(collapsed.textContent).toBe('')
    expect(collapsed.getAttribute('aria-label')).toBe('Open quick search (Ctrl K)')
    fireEvent.click(collapsed)
    expect(isPaletteOpen()).toBe(true)

    act(() => setWidth(SEARCH_COLLAPSE_WIDTH))
    expect(screen.getByTestId('palette-open-button').dataset.collapsed).toBe('false')
  })

  it('맥이면 ⌘K 힌트', async () => {
    stub('darwin')
    renderButton()
    await vi.waitFor(() =>
      expect(screen.getByTestId('palette-open-button').textContent).toContain('⌘')
    )
  })
})
