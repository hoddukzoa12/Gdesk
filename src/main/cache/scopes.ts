import type { DatabaseSync } from 'node:sqlite'
import { bool, num, str } from './rows'

/**
 * PR·이슈 목록 소속(scope). 한 행이 여러 목록에 속할 수 있고, 목록 하나를 다시 쓸 때 다른 목록은 남는다.
 * - `repo:<저장소 ID>`: 그 저장소의 열린 항목(들어온 PR·이슈, 상세 화면의 근거)
 * - PR: `mine`, `review_requested` / 이슈: `mine`, `assigned`
 * 목록마다 GitHub 의 전체 개수와 완전성을 cache_list_meta 에 둔다(키 `<kind>:<scope>`).
 */
export function repoScope(repoId: number): string {
  return `repo:${repoId}`
}

export interface ScopeTables {
  /** cache_list_meta 키 접두사 */
  kind: 'pr' | 'issue'
  items: string
  scopes: string
  /** scopes 표에서 항목 ID 열 */
  idColumn: string
  /** cache_repositories 의 열린 수 열 */
  repoCountColumn: 'open_pr_count' | 'open_issue_count'
}

export interface ScopedItem {
  id: string
  updatedAt: string
}

/**
 * - replace: 목록 소속을 items 로 통째로 바꾼다(검색 목록).
 * - window: 저장소 범위용. items 가 전체(totalCount)를 다 담으면 통째로 바꾸고, 상한에 잘렸으면
 *   기존 행을 줄이지 않고 합친다. 이때 받은 창(최근 갱신 순)의 가장 오래된 시각보다 최근인데
 *   이번에 없는 기존 행은 닫힌 것이므로 뺀다(열려 있었다면 창 안에 있어야 한다).
 */
export type ScopeWriteMode = 'replace' | 'window'

export interface ListMeta {
  totalCount: number
  complete: boolean
}

function metaKey(tables: ScopeTables, scope: string): string {
  return `${tables.kind}:${scope}`
}

export function getListMeta(db: DatabaseSync, tables: ScopeTables, scope: string): ListMeta | null {
  const row = db
    .prepare('SELECT total_count, complete FROM cache_list_meta WHERE scope = ?')
    .get(metaKey(tables, scope))
  return row === undefined
    ? null
    : { totalCount: num(row, 'total_count'), complete: bool(row, 'complete') }
}

function memberIds(db: DatabaseSync, tables: ScopeTables, scope: string): Map<string, string> {
  return new Map(
    db
      .prepare(
        `SELECT i.id, i.updated_at FROM ${tables.items} i
         JOIN ${tables.scopes} s ON s.${tables.idColumn} = i.id AND s.scope = ?`
      )
      .all(scope)
      .map((row) => [str(row, 'id'), str(row, 'updated_at')])
  )
}

/** 목록 소속과 메타를 쓴다. 항목 행 자체는 호출자가 먼저 넣는다. 트랜잭션 안에서 부른다 */
export function writeScope(
  db: DatabaseSync,
  tables: ScopeTables,
  scope: string,
  items: readonly ScopedItem[],
  totalCount: number | undefined,
  mode: ScopeWriteMode
): void {
  const total = Math.max(totalCount ?? items.length, items.length)
  const truncated = items.length < total
  const remove = db.prepare(
    `DELETE FROM ${tables.scopes} WHERE scope = ? AND ${tables.idColumn} = ?`
  )
  const insert = db.prepare(
    `INSERT OR IGNORE INTO ${tables.scopes} (scope, ${tables.idColumn}) VALUES (?, ?)`
  )
  if (mode === 'replace' || !truncated) {
    db.prepare(`DELETE FROM ${tables.scopes} WHERE scope = ?`).run(scope)
  } else if (items.length > 0) {
    const fresh = new Set(items.map((i) => i.id))
    const oldest = items.reduce(
      (min, i) => (i.updatedAt < min ? i.updatedAt : min),
      items[0]!.updatedAt
    )
    for (const [id, updatedAt] of memberIds(db, tables, scope)) {
      if (!fresh.has(id) && updatedAt > oldest) remove.run(scope, id)
    }
  }
  for (const item of items) insert.run(scope, item.id)
  db.exec(
    `DELETE FROM ${tables.items} WHERE id NOT IN (SELECT ${tables.idColumn} FROM ${tables.scopes})`
  )
  const stored = memberIds(db, tables, scope).size
  const complete = mode === 'replace' ? !truncated : stored >= total
  db.prepare(
    'INSERT OR REPLACE INTO cache_list_meta (scope, total_count, complete) VALUES (?, ?, ?)'
  ).run(metaKey(tables, scope), total, complete ? 1 : 0)
}

/** 목록의 전체 개수·완전성. 메타가 없으면 저장된 행 수로 본다 */
export function scopeMeta(db: DatabaseSync, tables: ScopeTables, scope: string): ListMeta {
  const meta = getListMeta(db, tables, scope)
  if (meta) return meta
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${tables.scopes} WHERE scope = ?`).get(scope)
  return { totalCount: row === undefined ? 0 : num(row, 'n'), complete: true }
}

/**
 * 들어온 항목(내 저장소 집합의 열린 항목 중 내가 쓰지 않은 것)의 전체 개수와 완전성.
 * 저장소마다:
 * - 저장소 범위를 다 받았으면 받은 행으로 센다(내 것 제외).
 * - 잘렸거나 아직 안 받았으면 GitHub 전체 개수(범위 메타, 없으면 저장소 머리글의 열린 수)에서
 *   캐시가 아는 내 열린 항목 수를 뺀다. 목록 상한에 잘리지 않는다.
 */
export function incomingSummary(db: DatabaseSync, tables: ScopeTables): ListMeta {
  const repos = db
    .prepare(`SELECT id, ${tables.repoCountColumn} AS n FROM cache_repositories WHERE is_mine = 1`)
    .all()
  if (repos.length === 0) return { totalCount: 0, complete: true }
  const metas = new Map(
    db
      .prepare('SELECT scope, total_count, complete FROM cache_list_meta WHERE scope LIKE ?')
      .all(`${tables.kind}:repo:%`)
      .map((row) => [
        str(row, 'scope'),
        { totalCount: num(row, 'total_count'), complete: bool(row, 'complete') }
      ])
  )
  const inScope = new Map<number, { all: number; mine: number }>()
  for (const row of db
    .prepare(
      `SELECT i.repo_id, COUNT(*) AS n, SUM(i.viewer_is_author) AS mine FROM ${tables.items} i
       JOIN ${tables.scopes} s ON s.${tables.idColumn} = i.id AND s.scope = 'repo:' || i.repo_id
       GROUP BY i.repo_id`
    )
    .all()) {
    inScope.set(num(row, 'repo_id'), { all: num(row, 'n'), mine: num(row, 'mine') })
  }
  const myOpen = new Map(
    db
      .prepare(
        `SELECT repo_id, COUNT(*) AS n FROM ${tables.items} WHERE viewer_is_author = 1 GROUP BY repo_id`
      )
      .all()
      .map((row) => [num(row, 'repo_id'), num(row, 'n')])
  )
  let totalCount = 0
  let complete = true
  for (const repo of repos) {
    const id = num(repo, 'id')
    const meta = metas.get(`${tables.kind}:${repoScope(id)}`)
    if (meta?.complete) {
      const rows = inScope.get(id)
      totalCount += rows ? rows.all - rows.mine : 0
      continue
    }
    const total = meta?.totalCount ?? num(repo, 'n')
    if (total > 0) complete = false
    totalCount += Math.max(0, total - (myOpen.get(id) ?? 0))
  }
  return { totalCount, complete }
}
