import type { DatabaseSync } from 'node:sqlite'
import type { NotificationListOptions, NotificationRow } from '@shared/domain/notification'
import { withTransaction } from '../db/transaction'
import { limitClause } from './pull-requests'
import { bool, num, numOrNull, str, strOrNull, sqlBool } from './rows'
import type { Row } from './rows'
import type { NotificationRecord } from './types'

/**
 * 알림 캐시 (spec §4.3). 완료(done)되지 않은 스레드만 둔다.
 * - 수집이 완전하면 목록을 통째로 바꾸고(replaceNotifications), 페이지 한도로 잘렸으면 합친다(mergeNotifications).
 * - 완료한 스레드는 cache_notification_done 에 (스레드 ID, 그때의 갱신 시각)을 남긴다. 이후 받은 목록에
 *   같은(또는 이전) 갱신 시각으로 오면 숨기고, 더 새 갱신 시각(새 활동)으로 오면 다시 보이며 기록을 지운다.
 *   완료 요청 전에 시작한 갱신이 늦게 도착해도 다시 나타나지 않는다.
 */
const SELECT = `SELECT thread_id, unread, reason, subject_title, subject_type, subject_url, url,
  repo_id, repo_full_name, updated_at FROM cache_notifications`

function toRecord(row: Row): NotificationRecord {
  return {
    threadId: str(row, 'thread_id'),
    state: bool(row, 'unread') ? 'unread' : 'read',
    reason: str(row, 'reason'),
    subjectTitle: str(row, 'subject_title'),
    subjectType: str(row, 'subject_type'),
    subjectApiUrl: strOrNull(row, 'subject_url'),
    url: str(row, 'url'),
    repoId: numOrNull(row, 'repo_id'),
    repoFullName: str(row, 'repo_full_name'),
    updatedAt: str(row, 'updated_at')
  }
}

function toRow(record: NotificationRecord): NotificationRow {
  const { subjectApiUrl: _omit, ...row } = record
  return row
}

function insert(db: DatabaseSync, n: NotificationRecord): void {
  db.prepare(
    `INSERT OR REPLACE INTO cache_notifications (thread_id, unread, reason, subject_title,
       subject_type, subject_url, url, repo_id, repo_full_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    n.threadId,
    sqlBool(n.state === 'unread'),
    n.reason,
    n.subjectTitle,
    n.subjectType,
    n.subjectApiUrl,
    n.url,
    n.repoId,
    n.repoFullName,
    n.updatedAt
  )
}

function isAfter(a: string, b: string): boolean {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  return Number.isFinite(ta) && Number.isFinite(tb) ? ta > tb : a > b
}

/** 완료 기록에 걸리는 스레드는 빼고, 새 활동으로 돌아온 스레드의 기록은 지운다 */
function withoutDone(db: DatabaseSync, items: readonly NotificationRecord[]): NotificationRecord[] {
  const done = new Map(
    db
      .prepare('SELECT thread_id, updated_at FROM cache_notification_done')
      .all()
      .map((row) => [str(row, 'thread_id'), str(row, 'updated_at')])
  )
  if (done.size === 0) return [...items]
  const clear = db.prepare('DELETE FROM cache_notification_done WHERE thread_id = ?')
  return items.filter((n) => {
    const doneAt = done.get(n.threadId)
    if (doneAt === undefined) return true
    if (!isAfter(n.updatedAt, doneAt)) return false
    clear.run(n.threadId)
    return true
  })
}

function setComplete(db: DatabaseSync, complete: boolean, total: number): void {
  db.prepare(
    "INSERT OR REPLACE INTO cache_list_meta (scope, total_count, complete) VALUES ('notification:all', ?, ?)"
  ).run(total, sqlBool(complete))
}

/**
 * 알림 목록 전체를 바꾼다(빠진 스레드는 완료된 것). 완전한 수집 결과에만 쓴다.
 * 목록에 없는 스레드의 완료 기록은 GitHub 에 반영된 것이므로 지운다.
 */
export function replaceNotifications(db: DatabaseSync, items: readonly NotificationRecord[]): void {
  withTransaction(db, () => {
    const ids = new Set(items.map((n) => n.threadId))
    const visible = withoutDone(db, items)
    db.exec('DELETE FROM cache_notifications')
    for (const n of visible) insert(db, n)
    const forget = db.prepare('DELETE FROM cache_notification_done WHERE thread_id = ?')
    for (const row of db.prepare('SELECT thread_id FROM cache_notification_done').all()) {
      if (!ids.has(str(row, 'thread_id'))) forget.run(str(row, 'thread_id'))
    }
    setComplete(db, true, visible.length)
  })
}

/** 잘린(페이지 한도) 수집 결과를 합친다. 기존 스레드는 지우지 않는다 */
export function mergeNotifications(db: DatabaseSync, items: readonly NotificationRecord[]): void {
  withTransaction(db, () => {
    for (const n of withoutDone(db, items)) insert(db, n)
    const total = num(db.prepare('SELECT COUNT(*) AS n FROM cache_notifications').get() ?? {}, 'n')
    setComplete(db, false, total)
  })
}

/** 마지막 수집이 모든 페이지를 받았는가 */
export function isNotificationListComplete(db: DatabaseSync): boolean {
  const row = db
    .prepare("SELECT complete FROM cache_list_meta WHERE scope = 'notification:all'")
    .get()
  return row === undefined || bool(row, 'complete')
}

/** Inbox 목록, 최근 갱신 순 */
export function listNotifications(
  db: DatabaseSync,
  options: NotificationListOptions = {}
): NotificationRow[] {
  const where: string[] = []
  const params: (string | number)[] = []
  if (options.unreadOnly) where.push('unread = 1')
  if (options.repoId !== undefined) {
    where.push('repo_id = ?')
    params.push(options.repoId)
  }
  if (options.reason) {
    where.push('reason = ?')
    params.push(options.reason)
  }
  const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
  return db
    .prepare(`${SELECT}${clause} ORDER BY updated_at DESC, thread_id${limitClause(options.limit)}`)
    .all(...params)
    .map((row) => toRow(toRecord(row)))
}

export function countUnreadNotifications(db: DatabaseSync): number {
  return num(
    db.prepare('SELECT COUNT(*) AS n FROM cache_notifications WHERE unread = 1').get() ?? {},
    'n'
  )
}

export function getNotification(db: DatabaseSync, threadId: string): NotificationRecord | null {
  const row = db.prepare(`${SELECT} WHERE thread_id = ?`).get(threadId)
  return row === undefined ? null : toRecord(row)
}

/** 읽음 처리를 캐시에 바로 반영한다. 이전 값을 돌려준다(없으면 null). 실패하면 restoreNotification */
export function markNotificationRead(
  db: DatabaseSync,
  threadId: string
): NotificationRecord | null {
  return withTransaction(db, () => {
    const prev = getNotification(db, threadId)
    if (prev === null) return null
    db.prepare('UPDATE cache_notifications SET unread = 0 WHERE thread_id = ?').run(threadId)
    return prev
  })
}

/**
 * 완료 처리: 목록에서 지우고 완료 기록(스레드 ID, 갱신 시각)을 남긴다.
 * 이전 값을 돌려준다(없으면 null). 실패하면 restoreNotification 으로 되돌린다.
 */
export function removeNotification(db: DatabaseSync, threadId: string): NotificationRecord | null {
  return withTransaction(db, () => {
    const prev = getNotification(db, threadId)
    if (prev === null) return null
    db.prepare('DELETE FROM cache_notifications WHERE thread_id = ?').run(threadId)
    db.prepare(
      'INSERT OR REPLACE INTO cache_notification_done (thread_id, updated_at) VALUES (?, ?)'
    ).run(threadId, prev.updatedAt)
    return prev
  })
}

/** markNotificationRead·removeNotification 이 돌려준 이전 값으로 되돌린다(완료 기록도 지운다) */
export function restoreNotification(db: DatabaseSync, snapshot: NotificationRecord): void {
  withTransaction(db, () => {
    db.prepare('DELETE FROM cache_notification_done WHERE thread_id = ?').run(snapshot.threadId)
    insert(db, snapshot)
  })
}
