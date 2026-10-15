import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type DateInput = Date | string | number

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 30],
  ['month', 12],
  ['year', Infinity]
]

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * 상대 시각 문구. en "8h ago", ko "8시간 전". 5초 미만은 "now" / "지금".
 * 단위는 초 < 60, 분 < 60, 시 < 24, 일 < 30, 월(30일) < 12, 그 이상은 년(360일).
 */
export function formatRelativeTime(
  value: DateInput,
  now: DateInput,
  locale: string,
  style: Intl.RelativeTimeFormatStyle = 'narrow'
): string {
  const diffSec = Math.round((toDate(value).getTime() - toDate(now).getTime()) / 1000)
  const abs = Math.abs(diffSec)
  // 5초 미만은 "now" / "지금"
  if (abs < 5)
    return new Intl.RelativeTimeFormat(locale, { style, numeric: 'auto' }).format(0, 'second')
  const rtf = new Intl.RelativeTimeFormat(locale, { style, numeric: 'always' })
  let elapsed = abs
  for (const [unit, limit] of UNITS) {
    if (elapsed < limit) {
      const amount = Math.floor(elapsed)
      return rtf.format(diffSec < 0 ? -amount : amount, unit)
    }
    elapsed = elapsed / limit
  }
  return rtf.format(0, 'second')
}

/** 지금 시각. `intervalMs` 마다 갱신한다. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export interface RelativeTimeProps {
  date: DateInput
  /** 기준 시각(테스트용). 없으면 현재 시각을 쓰고 30초마다 갱신. */
  now?: DateInput
  style?: Intl.RelativeTimeFormatStyle
  className?: string
}

/** `<time>` 으로 상대 시각을 보여 준다. 마우스를 올리면 절대 시각. */
export function RelativeTime({ date, now, style = 'narrow', className }: RelativeTimeProps) {
  const { i18n } = useTranslation()
  const tick = useNow()
  const d = toDate(date)
  if (Number.isNaN(d.getTime())) return null
  const locale = i18n.language
  return (
    <time
      dateTime={d.toISOString()}
      title={new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d)}
      className={className}
    >
      {formatRelativeTime(d, now ?? tick, locale, style)}
    </time>
  )
}
