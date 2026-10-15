// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { i18n } from '../app/i18n'
import { RelativeTime, formatRelativeTime } from './RelativeTime'

afterEach(cleanup)

const NOW = new Date('2026-10-15T12:00:00Z')
const ago = (sec: number): Date => new Date(NOW.getTime() - sec * 1000)

describe('formatRelativeTime', () => {
  const cases: Array<[number, string, string]> = [
    [0, 'now', '지금'],
    [4, 'now', '지금'],
    [5, '5s ago', '5초 전'],
    [27, '27s ago', '27초 전'],
    [5 * 60, '5m ago', '5분 전'],
    [8 * 3600, '8h ago', '8시간 전'],
    [23 * 3600 + 59 * 60, '23h ago', '23시간 전'],
    [2 * 86400, '2d ago', '2일 전'],
    [65 * 86400, '2mo ago', '2개월 전'],
    [800 * 86400, '2y ago', '2년 전']
  ]
  it.each(cases)('%i초 전 → en "%s", ko "%s"', (sec, en, ko) => {
    expect(formatRelativeTime(ago(sec), NOW, 'en')).toBe(en)
    expect(formatRelativeTime(ago(sec), NOW, 'ko')).toBe(ko)
  })

  it('미래 시각', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() + 3 * 3600_000), NOW, 'en')).toBe('in 3h')
    expect(formatRelativeTime(new Date(NOW.getTime() + 3 * 3600_000), NOW, 'ko')).toBe('3시간 후')
  })

  it('long 형식', () => {
    expect(formatRelativeTime(ago(8 * 3600), NOW, 'en', 'long')).toBe('8 hours ago')
  })
})

describe('<RelativeTime>', () => {
  it('현재 언어로 그리고 언어 전환에 따라 바뀐다', async () => {
    await act(() => i18n.changeLanguage('en'))
    render(
      <I18nextProvider i18n={i18n}>
        <RelativeTime date={ago(8 * 3600).toISOString()} now={NOW} />
      </I18nextProvider>
    )
    const el = screen.getByText('8h ago')
    expect(el.tagName).toBe('TIME')
    expect(el.getAttribute('datetime')).toBe(ago(8 * 3600).toISOString())

    await act(() => i18n.changeLanguage('ko'))
    expect(screen.getByText('8시간 전')).toBeTruthy()
    await act(() => i18n.changeLanguage('en'))
  })

  it('잘못된 날짜는 그리지 않는다', () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <RelativeTime date="not-a-date" now={NOW} />
      </I18nextProvider>
    )
    expect(container.innerHTML).toBe('')
  })
})
