import { describe, expect, it } from 'vitest'
import { dailyStarCounts, starWindowStart, starsGained } from './stars'

const DAY = 86_400_000
// 2026-10-15T12:00:00Z
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0)

describe('dailyStarCounts', () => {
  it('30일 버킷: 오래된 날 → 오늘, 마지막이 오늘', () => {
    const daily = dailyStarCounts([], { now: NOW, days: 30 })
    expect(daily).toHaveLength(30)
    expect(daily[0]!.date).toBe('2026-09-16')
    expect(daily[29]!.date).toBe('2026-10-15')
    expect(daily.every((d) => d.count === 0)).toBe(true)
  })

  it('날짜별로 센다', () => {
    const daily = dailyStarCounts(
      [
        '2026-10-15T00:00:00Z',
        '2026-10-15T11:59:59Z',
        '2026-10-14T23:59:59Z',
        '2026-09-16T00:00:00Z'
      ],
      { now: NOW, days: 30 }
    )
    expect(daily[29]).toEqual({ date: '2026-10-15', count: 2 })
    expect(daily[28]).toEqual({ date: '2026-10-14', count: 1 })
    expect(daily[0]).toEqual({ date: '2026-09-16', count: 1 })
  })

  it('시간대 차이(utcOffsetMinutes)를 반영한다', () => {
    // UTC 10-14 20:00 은 +09:00 에서 10-15 05:00
    const daily = dailyStarCounts(['2026-10-14T20:00:00Z'], {
      now: NOW,
      days: 2,
      utcOffsetMinutes: 540
    })
    expect(daily).toEqual([
      { date: '2026-10-14', count: 0 },
      { date: '2026-10-15', count: 1 }
    ])
  })
})

describe('starsGained — 창 경계', () => {
  const start7 = starWindowStart({ now: NOW, days: 7 })

  it('7일 창의 시작은 6일 전 자정(UTC)', () => {
    expect(new Date(start7).toISOString()).toBe('2026-10-09T00:00:00.000Z')
  })

  it.each([
    ['창 시작 시각 정각은 포함', start7, 1],
    ['창 시작 1ms 전은 제외', start7 - 1, 0],
    ['지금 정각은 포함', NOW, 1],
    ['오늘 안의 미래 시각도 오늘로 포함', NOW + 60_000, 1],
    ['내일은 제외', Date.UTC(2026, 9, 16, 0, 0, 0), 0],
    ['8일 전은 제외', NOW - 8 * DAY, 0]
  ] as const)('%s', (_name, at, expected) => {
    expect(starsGained([at], { now: NOW, days: 7 })).toBe(expected)
  })

  it('Home 7일 합 = 30일 일별의 마지막 7칸 합', () => {
    const stamps = Array.from({ length: 40 }, (_, i) => NOW - i * DAY * 0.8)
    const daily = dailyStarCounts(stamps, { now: NOW, days: 30 })
    const last7 = daily.slice(-7).reduce((n, d) => n + d.count, 0)
    expect(starsGained(stamps, { now: NOW, days: 7 })).toBe(last7)
    expect(starsGained(stamps, { now: NOW, days: 30 })).toBe(daily.reduce((n, d) => n + d.count, 0))
  })

  it('잘못된 시각 문자열은 무시한다', () => {
    expect(starsGained(['not-a-date', '2026-10-15T00:00:00Z'], { now: NOW, days: 7 })).toBe(1)
  })
})
