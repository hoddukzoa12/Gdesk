import type { DatabaseSync } from 'node:sqlite'

let savepointSeq = 0

/**
 * fn 을 트랜잭션 안에서 실행한다. 오류가 나면 되돌리고 다시 던진다.
 * 이미 트랜잭션 안이면 SAVEPOINT 로 중첩한다.
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) {
    const name = `gdesk_sp_${++savepointSeq}`
    db.exec(`SAVEPOINT ${name}`)
    try {
      const result = fn()
      db.exec(`RELEASE ${name}`)
      return result
    } catch (err) {
      db.exec(`ROLLBACK TO ${name}`)
      db.exec(`RELEASE ${name}`)
      throw err
    }
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw err
  }
}
