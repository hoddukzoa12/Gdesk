import type { DatabaseSync } from 'node:sqlite'

/**
 * 계정 정보. 마지막 로그인 사용자 ID 는 로그아웃해도 지우지 않는다(spec 5).
 * 다음 로그인 때 다른 계정인지 판정하는 데 쓴다.
 */
const LAST_USER_ID = 'last_user_id'

function assertUserId(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error(`Invalid GitHub user id: ${userId}`)
  }
}

export function getLastUserId(db: DatabaseSync): number | null {
  const row = db.prepare('SELECT value FROM account_meta WHERE key = ?').get(LAST_USER_ID)
  if (row === undefined) return null
  const id = Number(row.value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function setLastUserId(db: DatabaseSync, userId: number): void {
  assertUserId(userId)
  db.prepare(
    'INSERT INTO account_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(LAST_USER_ID, String(userId))
}

/** 이전에 로그인한 사용자가 있고 그와 다른 사용자이면 true */
export function isDifferentAccount(db: DatabaseSync, userId: number): boolean {
  const last = getLastUserId(db)
  return last !== null && last !== userId
}
