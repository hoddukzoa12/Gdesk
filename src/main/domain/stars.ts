import type { DailyCount } from '@shared/domain/stats'

/**
 * 스타 증가 계산 (spec §4.2, §4.9).
 * 창은 달력 날짜 단위다. N일 창 = 오늘(진행 중) + 그 앞 N-1일. 날짜는 utcOffsetMinutes 시간대 기준(기본 UTC).
 * Home 7일 합은 30일 일별 그래프의 마지막 7칸 합과 항상 같다.
 */
export interface StarWindowOptions {
  now: number
  days: number
  /** 날짜 경계를 정할 시간대(분). 예: 한국 540. 기본 0(UTC) */
  utcOffsetMinutes?: number
}

const DAY_MS = 86_400_000

function toMs(value: string | number): number {
  return typeof value === 'number' ? value : Date.parse(value)
}

function dayIndex(ms: number, offsetMs: number): number {
  return Math.floor((ms + offsetMs) / DAY_MS)
}

function windowBounds(options: StarWindowOptions): {
  first: number
  last: number
  offsetMs: number
} {
  const offsetMs = (options.utcOffsetMinutes ?? 0) * 60_000
  const days = Math.max(1, Math.floor(options.days))
  const last = dayIndex(options.now, offsetMs)
  return { first: last - days + 1, last, offsetMs }
}

/** 창의 시작 시각(epoch ms): 첫 날의 0시(해당 시간대) */
export function starWindowStart(options: StarWindowOptions): number {
  const { first, offsetMs } = windowBounds(options)
  return first * DAY_MS - offsetMs
}

/** 일별 스타 수. 오래된 날 → 오늘 순, 길이 = days. 창 밖·잘못된 시각은 무시 */
export function dailyStarCounts(
  timestamps: readonly (string | number)[],
  options: StarWindowOptions
): DailyCount[] {
  const { first, last, offsetMs } = windowBounds(options)
  const counts = new Array<number>(last - first + 1).fill(0)
  for (const stamp of timestamps) {
    const ms = toMs(stamp)
    if (!Number.isFinite(ms)) continue
    const idx = dayIndex(ms, offsetMs)
    if (idx < first || idx > last) continue
    counts[idx - first] = (counts[idx - first] ?? 0) + 1
  }
  return counts.map((count, i) => ({
    date: new Date((first + i) * DAY_MS).toISOString().slice(0, 10),
    count
  }))
}

/** 창 동안 늘어난 스타 수 = dailyStarCounts 의 합 */
export function starsGained(
  timestamps: readonly (string | number)[],
  options: StarWindowOptions
): number {
  return dailyStarCounts(timestamps, options).reduce((n, d) => n + d.count, 0)
}
