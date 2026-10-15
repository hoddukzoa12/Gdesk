import type { DatabaseSync } from 'node:sqlite'
import type { NotificationListOptions, NotificationRow } from '@shared/domain/notification'
import { withTransaction } from '../db/transaction'
import { limitClause } from './pull-requests'
import { bool, num, numOrNull, str, strOrNull, sqlBool } from './rows'
import type { Row } from './rows'
import type { NotificationRecord } from './types'

/**
 * 알림 캐시 (spec §4.3). 완료(done)되지 않은 스레드만 둔다. 목록은 수집 때마다 통째로 바꾼다.
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

/** 알림 목록 전체를 바꾼다(빠진 스레드는 완료된 것) */
export function replaceNotifications(db: DatabaseSync, items: readonly NotificationRecord[]): void {
  withTransaction(db, () => {
    db.exec('DELETE FROM cache_notifications')
    for (const n of items) insert(db, n)
  })
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

/** 완료 처리: 목록에서 지운다. 이전 값을 돌려준다(없으면 null). 실패하면 restoreNotification */
export function removeNotification(db: DatabaseSync, threadId: string): NotificationRecord | null {
  return withTransaction(db, () => {
    const prev = getNotification(db, threadId)
    if (prev === null) return null
    db.prepare('DELETE FROM cache_notifications WHERE thread_id = ?').run(threadId)
    return prev
  })
}

/** markNotificationRead·removeNotification 이 돌려준 이전 값으로 되돌린다 */
export function restoreNotification(db: DatabaseSync, snapshot: NotificationRecord): void {
  insert(db, snapshot)
}
