import type { DatabaseSync } from 'node:sqlite'

/**
 * PR·이슈 목록 소속(scope). 한 행이 여러 목록에 속할 수 있고, 목록 하나를 다시 쓸 때 다른 목록은 남는다.
 * - `repo:<저장소 ID>`: 그 저장소의 열린 항목(들어온 PR·이슈, 상세 화면의 근거)
 * - PR: `mine`, `review_requested` / 이슈: `mine`, `assigned`
 */
export function repoScope(repoId: number): string {
  return `repo:${repoId}`
}

export interface ScopeTables {
  items: string
  scopes: string
  /** scopes 표에서 항목 ID 열 */
  idColumn: string
}

/** 목록 하나의 소속을 ids 로 바꾸고, 어느 목록에도 속하지 않는 항목 행을 지운다. 트랜잭션 안에서 부른다 */
export function replaceScope(
  db: DatabaseSync,
  tables: ScopeTables,
  scope: string,
  ids: readonly string[]
): void {
  db.prepare(`DELETE FROM ${tables.scopes} WHERE scope = ?`).run(scope)
  const insert = db.prepare(
    `INSERT OR IGNORE INTO ${tables.scopes} (scope, ${tables.idColumn}) VALUES (?, ?)`
  )
  for (const id of ids) insert.run(scope, id)
  db.exec(
    `DELETE FROM ${tables.items} WHERE id NOT IN (SELECT ${tables.idColumn} FROM ${tables.scopes})`
  )
}
