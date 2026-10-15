import { beforeAll, describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import { i18n } from '@renderer/app/i18n'
import { footerText, formatClock } from './footerText'

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)

function tFor(lng: 'en' | 'ko'): TFunction<'sidebar'> {
  return i18n.getFixedT(lng, 'sidebar') as TFunction<'sidebar'>
}

const base = { connection: 'online' as const, lastSyncedAt: NOW - 27_000, rateLimitedUntil: null }

beforeAll(async () => {
  await i18n.loadNamespaces('sidebar')
})

describe('footerText', () => {
  it('온라인: N초 전 동기화', () => {
    expect(footerText(base, NOW, 'en', tFor('en'))).toBe('Synced 27s ago')
    expect(footerText(base, NOW, 'ko', tFor('ko'))).toBe('27초 전 동기화됨')
  })

  it('방금 받은 시각이 화면 시각보다 앞서도 미래로 표시하지 않는다', () => {
    const s = { ...base, lastSyncedAt: NOW + 4_000 }
    expect(footerText(s, NOW, 'en', tFor('en'))).toBe('Synced now')
    expect(footerText({ ...s, lastSyncedAt: NOW + 9_000 }, NOW, 'ko', tFor('ko'))).toBe(
      '지금 동기화됨'
    )
  })

  it('아직 동기화 전', () => {
    const s = { ...base, lastSyncedAt: null }
    expect(footerText(s, NOW, 'en', tFor('en'))).toBe('Not synced yet')
    expect(footerText(s, NOW, 'ko', tFor('ko'))).toBe('아직 동기화하지 않음')
  })

  it('오프라인: 오프라인 · N분 전 정보', () => {
    const s = { ...base, connection: 'offline' as const, lastSyncedAt: NOW - 5 * 60_000 }
    expect(footerText(s, NOW, 'ko', tFor('ko'))).toBe('오프라인 · 5분 전 정보')
    expect(footerText(s, NOW, 'en', tFor('en'))).toBe('Offline · data from 5m ago')
    expect(footerText({ ...s, lastSyncedAt: null }, NOW, 'ko', tFor('ko'))).toBe('오프라인')
  })

  it('한도 대기: HH:MM에 재개', () => {
    const until = NOW + 15 * 60_000
    const s = { ...base, connection: 'rate_limited' as const, rateLimitedUntil: until }
    const clock = formatClock(until, 'ko')
    expect(clock).toMatch(/^\d{2}:\d{2}$/)
    expect(footerText(s, NOW, 'ko', tFor('ko'))).toBe(`요청 한도 대기 · ${clock}에 재개`)
    expect(footerText(s, NOW, 'en', tFor('en'))).toBe(
      `Rate limited · resumes at ${formatClock(until, 'en')}`
    )
    expect(footerText({ ...s, rateLimitedUntil: null }, NOW, 'en', tFor('en'))).toBe(
      'Rate limited · waiting'
    )
  })

  it('세션 만료: 마지막 정보 시각', () => {
    const s = { ...base, connection: 'session_expired' as const, lastSyncedAt: NOW - 3_600_000 }
    expect(footerText(s, NOW, 'ko', tFor('ko'))).toBe('세션 만료 · 1시간 전 정보')
    expect(footerText(s, NOW, 'en', tFor('en'))).toBe('Session expired · data from 1h ago')
  })
})

describe('formatClock', () => {
  it('24시간 HH:MM', () => {
    const at = new Date(2026, 9, 16, 9, 5).getTime()
    expect(formatClock(at, 'en')).toBe('09:05')
    expect(formatClock(at, 'ko')).toBe('09:05')
  })
})
