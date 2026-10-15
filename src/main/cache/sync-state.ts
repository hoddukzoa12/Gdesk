import type { DatabaseSync } from 'node:sqlite'
import { numOrNull, str, strOrNull } from './rows'
import type { Row } from './rows'

/**
 * 갱신 범위별 동기화 상태. 범위 이름은 동기화 엔진이 정한다
 * (예: `notifications`, `repositories`, `starred`, `pulls`, `reviews`, `issues`, `repo:<ID>`).
 * 알림은 조건부 요청용 etag·last-modified 와 GitHub 최소 폴링 간격(초)을 함께 둔다.
 */
export interface SyncState {
  scope: string
  /** epoch ms */
  lastSyncedAt: number | null
  etag: string | null
  lastModified: string | null
  /** 초 (X-Poll-Interval) */
  pollInterval: number | null
}

export type SyncStatePatch = Partial<Omit<SyncState, 'scope'>>

function toState(row: Row): SyncState {
  return {
    scope: str(row, 'scope'),
    lastSyncedAt: numOrNull(row, 'last_synced_at'),
    etag: strOrNull(row, 'etag'),
    lastModified: strOrNull(row, 'last_modified'),
    pollInterval: numOrNull(row, 'poll_interval')
  }
}

export function getSyncState(db: DatabaseSync, scope: string): SyncState {
  const row = db.prepare('SELECT * FROM cache_sync_state WHERE scope = ?').get(scope)
  return row === undefined
    ? { scope, lastSyncedAt: null, etag: null, lastModified: null, pollInterval: null }
    : toState(row)
}

/** 준 필드만 바꾼다(undefined 는 그대로, null 은 지움) */
export function updateSyncState(db: DatabaseSync, scope: string, patch: SyncStatePatch): SyncState {
  const next = { ...getSyncState(db, scope) }
  if (patch.lastSyncedAt !== undefined) next.lastSyncedAt = patch.lastSyncedAt
  if (patch.etag !== undefined) next.etag = patch.etag
  if (patch.lastModified !== undefined) next.lastModified = patch.lastModified
  if (patch.pollInterval !== undefined) next.pollInterval = patch.pollInterval
  db.prepare(
    `INSERT OR REPLACE INTO cache_sync_state (scope, last_synced_at, etag, last_modified, poll_interval)
     VALUES (?, ?, ?, ?, ?)`
  ).run(scope, next.lastSyncedAt, next.etag, next.lastModified, next.pollInterval)
  return next
}

export function listSyncStates(db: DatabaseSync): SyncState[] {
  return db.prepare('SELECT * FROM cache_sync_state ORDER BY scope').all().map(toState)
}
