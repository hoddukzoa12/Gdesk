import type { NotificationRecord } from '../../cache/types'
import { resolveClient } from './common'
import type { CollectorOptions } from './common'
import { mapNotification } from './map'
import type { RawNotification } from './raw'

/**
 * GitHub 알림 (spec §4.3). `GET /notifications?all=true` 는 읽음·안 읽음을 모두 주고 완료(done)한 것은 주지 않는다.
 * 첫 페이지는 지난 etag·last-modified 로 조건부 요청한다. 304 면 변경 없음.
 * X-Poll-Interval(초)은 GitHub 의 최소 폴링 간격이므로 동기화 엔진이 지킨다.
 */
export interface NotificationsOptions extends CollectorOptions {
  etag?: string | null
  lastModified?: string | null
  /** 최대 페이지 수. 기본 5 */
  maxPages?: number
  /** 페이지 크기. 기본 50 */
  perPage?: number
}

export type NotificationsResult =
  | {
      notModified: true
      etag: string | null
      lastModified: string | null
      pollInterval: number | null
    }
  | {
      notModified: false
      notifications: NotificationRecord[]
      etag: string | null
      lastModified: string | null
      pollInterval: number | null
      /** 모든 페이지를 받았는가 */
      complete: boolean
    }

export const NOTIFICATIONS_PATH = '/notifications'

export async function collectNotifications(
  options: NotificationsOptions = {}
): Promise<NotificationsResult> {
  const client = resolveClient(options)
  const maxPages = Math.max(1, options.maxPages ?? 5)
  const first = await client.getConditional<RawNotification[]>(NOTIFICATIONS_PATH, {
    query: { all: true, per_page: options.perPage ?? 50 },
    etag: options.etag,
    lastModified: options.lastModified,
    signal: options.signal
  })
  const pollInterval = first.pollInterval ?? null
  if (first.notModified) {
    return {
      notModified: true,
      etag: first.etag ?? options.etag ?? null,
      lastModified: first.lastModified ?? options.lastModified ?? null,
      pollInterval
    }
  }
  const raw: RawNotification[] = Array.isArray(first.data) ? [...first.data] : []
  let next = first.links.next
  let pages = 1
  while (next && pages < maxPages) {
    const page = await client.get<RawNotification[]>(next, { signal: options.signal })
    if (Array.isArray(page.data)) raw.push(...page.data)
    next = page.links.next
    pages++
  }
  const seen = new Set<string>()
  const notifications = raw
    .map(mapNotification)
    .filter(
      (n): n is NotificationRecord => n !== null && !seen.has(n.threadId) && !!seen.add(n.threadId)
    )
  return {
    notModified: false,
    notifications,
    etag: first.etag ?? null,
    lastModified: first.lastModified ?? null,
    pollInterval,
    complete: !next
  }
}
