import type { TFunction } from 'i18next'
import type { SyncStatus } from '@shared/domain/sync'
import { formatRelativeTime } from '@renderer/components'

type FooterStatus = Pick<SyncStatus, 'connection' | 'lastSyncedAt' | 'rateLimitedUntil'>

/** 한도가 풀리는 시각 "HH:MM" (이 컴퓨터 시간대) */
export function formatClock(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(at)
}

/**
 * "27초 전" 같은 지난 시각 문구. 화면의 `now` 는 몇 초마다만 바뀌므로 방금 받은 시각이
 * 미래로 보이지 않게 맞춘다("3초 후" 대신 "지금").
 */
export function sinceText(at: number, now: number, locale: string): string {
  return formatRelativeTime(at, Math.max(now, at), locale)
}

/**
 * 사이드바 하단 문구 (spec §4.1, §6). 순수 함수라 `now` 를 고정해 테스트한다.
 * - online: "Synced 27s ago" / "동기화 27초 전"
 * - offline: "Offline · data from 5m ago" / "오프라인 · 5분 전 정보"
 * - rate_limited: "Rate limited · resumes at 14:05" / "요청 한도 대기 · 14:05에 재개"
 * - session_expired: "Session expired · data from 1h ago" / "세션 만료 · 1시간 전 정보"
 */
export function footerText(
  status: FooterStatus,
  now: number,
  locale: string,
  t: TFunction<'sidebar'>
): string {
  const time = status.lastSyncedAt === null ? null : sinceText(status.lastSyncedAt, now, locale)
  switch (status.connection) {
    case 'offline':
      return time === null ? t('footer.offlineNoData') : t('footer.offline', { time })
    case 'rate_limited':
      return status.rateLimitedUntil === null
        ? t('footer.rateLimitedNoTime')
        : t('footer.rateLimited', { time: formatClock(status.rateLimitedUntil, locale) })
    case 'session_expired':
      return time === null ? t('footer.sessionExpiredNoData') : t('footer.sessionExpired', { time })
    case 'online':
    default:
      return time === null ? t('footer.neverSynced') : t('footer.synced', { time })
  }
}
