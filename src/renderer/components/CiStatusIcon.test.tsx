// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { i18n } from '../app/i18n'
import { CI_STATUS_META, CiStatusIcon, type CiStatusValue } from './CiStatusIcon'
import { MiniBars } from './MiniBars'

afterEach(cleanup)

describe('CiStatusIcon', () => {
  const cases: Array<[CiStatusValue, string, string]> = [
    ['passing', 'text-success', 'Passing'],
    ['failing', 'text-danger', 'Failing'],
    ['pending', 'text-warning', 'Pending'],
    ['none', 'text-neutral', 'No CI']
  ]

  it.each(cases)('%s → %s, 라벨 "%s"', async (status, color, label) => {
    await i18n.changeLanguage('en')
    render(
      <I18nextProvider i18n={i18n}>
        <CiStatusIcon status={status} />
      </I18nextProvider>
    )
    const icon = screen.getByRole('img', { name: label })
    expect(icon.getAttribute('data-status')).toBe(status)
    expect(icon.className).toContain(color)
    expect(CI_STATUS_META[status].colorClass).toBe(color)
  })

  it('passing·failing·none 은 아이콘, pending 은 노란 점', () => {
    expect(CI_STATUS_META.passing.icon).not.toBeNull()
    expect(CI_STATUS_META.failing.icon).not.toBeNull()
    expect(CI_STATUS_META.none.icon).not.toBeNull()
    expect(CI_STATUS_META.pending.icon).toBeNull()
    expect(CI_STATUS_META.pending.bgClass).toBe('bg-warning')
  })

  it('한국어 라벨', async () => {
    await i18n.changeLanguage('ko')
    render(
      <I18nextProvider i18n={i18n}>
        <CiStatusIcon status="failing" />
      </I18nextProvider>
    )
    expect(screen.getByRole('img', { name: '실패' })).toBeTruthy()
    await i18n.changeLanguage('en')
  })

  it('MiniBars 는 상태마다 색 막대를 그린다', async () => {
    await i18n.changeLanguage('en')
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <MiniBars statuses={['passing', 'passing', 'failing', 'pending']} />
      </I18nextProvider>
    )
    const bars = container.querySelectorAll('[data-status]')
    expect([...bars].map((b) => b.getAttribute('data-status'))).toEqual([
      'passing',
      'passing',
      'failing',
      'pending'
    ])
    expect(bars[2]?.className).toContain('bg-danger')
    expect(screen.getByRole('img', { name: 'Passing 2 · Failing 1 · Pending 1' })).toBeTruthy()
  })
})
