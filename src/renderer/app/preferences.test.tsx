// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { i18n } from './i18n'
import { PreferencesProvider, usePreferences, type Preferences } from './preferences'

// matchMedia 흉내: OS 다크 모드를 바꾸고 변경 이벤트를 보낼 수 있다.
let osDark = true
const listeners = new Set<() => void>()
function setOsDark(v: boolean): void {
  osDark = v
  listeners.forEach((l) => l())
}

beforeEach(() => {
  osDark = true
  listeners.clear()
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return osDark
    },
    media: query,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l)
  })) as unknown as typeof window.matchMedia
})
afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

function Probe() {
  const p = usePreferences()
  return (
    <div>
      <span data-testid="state">{`${p.theme}/${p.resolvedTheme}/${p.language}/${p.resolvedLanguage}`}</span>
      <button type="button" onClick={() => p.setTheme('light')}>
        light
      </button>
      <button type="button" onClick={() => p.setLanguage('ko')}>
        ko
      </button>
    </div>
  )
}

const html = document.documentElement

describe('PreferencesProvider', () => {
  it('기본값은 system: OS 테마를 따르고 변경에 즉시 반응한다', () => {
    render(
      <PreferencesProvider osLocale="en-US">
        <Probe />
      </PreferencesProvider>
    )
    expect(html.dataset.theme).toBe('dark')
    expect(screen.getByTestId('state').textContent).toBe('system/dark/system/en')
    act(() => setOsDark(false))
    expect(html.dataset.theme).toBe('light')
    act(() => setOsDark(true))
    expect(html.dataset.theme).toBe('dark')
  })

  it('OS 가 한국어면 한국어로 시작한다', () => {
    render(
      <PreferencesProvider osLocale="ko-KR">
        <Probe />
      </PreferencesProvider>
    )
    expect(i18n.language).toBe('ko')
    expect(html.lang).toBe('ko')
  })

  it('비제어: 설정을 바꾸면 바로 적용하고 onChange 를 부른다', () => {
    const onChange = vi.fn<(p: Preferences) => void>()
    render(
      <PreferencesProvider osLocale="en-US" onChange={onChange}>
        <Probe />
      </PreferencesProvider>
    )
    act(() => screen.getByText('light').click())
    expect(html.dataset.theme).toBe('light')
    expect(onChange).toHaveBeenLastCalledWith({ theme: 'light', language: 'system' })
    act(() => screen.getByText('ko').click())
    expect(i18n.language).toBe('ko')
    expect(html.lang).toBe('ko')
    expect(onChange).toHaveBeenLastCalledWith({ theme: 'light', language: 'ko' })
  })

  it('제어: 바깥 값을 따른다', () => {
    const { rerender } = render(
      <PreferencesProvider osLocale="en-US" value={{ theme: 'light', language: 'en' }}>
        <Probe />
      </PreferencesProvider>
    )
    expect(html.dataset.theme).toBe('light')
    expect(i18n.language).toBe('en')
    rerender(
      <PreferencesProvider osLocale="en-US" value={{ theme: 'dark', language: 'ko' }}>
        <Probe />
      </PreferencesProvider>
    )
    expect(html.dataset.theme).toBe('dark')
    expect(i18n.language).toBe('ko')
    // OS 테마가 바뀌어도 명시한 테마는 그대로
    act(() => setOsDark(false))
    expect(html.dataset.theme).toBe('dark')
  })
})
