import type { DatabaseSync } from 'node:sqlite'
import type { Pin } from '@shared/domain/pin'
import { withTransaction } from '../db/transaction'

/**
 * 고정 저장소. 저장소 이름이 아니라 GitHub 숫자 저장소 ID 로 기억한다(spec 3).
 * 위치는 항상 0..n-1 로 빈틈없이 유지한다.
 */

type PinsListener = (pins: Pin[]) => void
const listeners = new Set<PinsListener>()

/** 고정 목록이 바뀔 때 알림을 받는다. 해제 함수를 돌려준다. */
export function onPinsChanged(listener: PinsListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(pins: Pin[]): void {
  for (const listener of [...listeners]) listener(pins)
}

export function assertRepoId(repoId: unknown): asserts repoId is number {
  if (typeof repoId !== 'number' || !Number.isSafeInteger(repoId) || repoId <= 0) {
    throw new Error(`Invalid repository id: ${String(repoId)}`)
  }
}

export function listPins(db: DatabaseSync): Pin[] {
  return db
    .prepare('SELECT repo_id, position FROM pins ORDER BY position, repo_id')
    .all()
    .map((row) => ({ repoId: Number(row.repo_id), position: Number(row.position) }))
}

function renumber(db: DatabaseSync, repoIds: readonly number[]): void {
  const update = db.prepare('UPDATE pins SET position = ? WHERE repo_id = ?')
  repoIds.forEach((id, index) => update.run(index, id))
}

/** 목록 끝에 고정한다. 이미 고정돼 있으면 그대로 둔다. */
export function pinRepo(db: DatabaseSync, repoId: number): Pin[] {
  assertRepoId(repoId)
  const changed = withTransaction(db, () => {
    const result = db
      .prepare(
        `INSERT INTO pins (repo_id, position)
         VALUES (?, (SELECT COALESCE(MAX(position) + 1, 0) FROM pins))
         ON CONFLICT (repo_id) DO NOTHING`
      )
      .run(repoId)
    return Number(result.changes) > 0
  })
  const pins = listPins(db)
  if (changed) notify(pins)
  return pins
}

/** 고정을 해제하고 남은 위치를 다시 매긴다. */
export function unpinRepo(db: DatabaseSync, repoId: number): Pin[] {
  assertRepoId(repoId)
  const changed = withTransaction(db, () => {
    const result = db.prepare('DELETE FROM pins WHERE repo_id = ?').run(repoId)
    if (Number(result.changes) === 0) return false
    renumber(
      db,
      listPins(db).map((p) => p.repoId)
    )
    return true
  })
  const pins = listPins(db)
  if (changed) notify(pins)
  return pins
}

/** 전체 순서 목록으로 순서를 바꾼다. 현재 고정 목록과 정확히 같은 집합이어야 한다. */
export function reorderPins(db: DatabaseSync, repoIds: readonly number[]): Pin[] {
  if (!Array.isArray(repoIds)) throw new Error('repoIds must be an array')
  repoIds.forEach(assertRepoId)
  withTransaction(db, () => {
    const current = listPins(db).map((p) => p.repoId)
    const given = new Set(repoIds)
    const sameSet =
      given.size === repoIds.length &&
      repoIds.length === current.length &&
      current.every((id) => given.has(id))
    if (!sameSet) throw new Error('Reorder list must contain exactly the pinned repository ids')
    renumber(db, repoIds)
  })
  const pins = listPins(db)
  notify(pins)
  return pins
}
