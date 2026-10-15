import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations, type Migration } from './migrations'

export interface OpenDatabaseOptions {
  /** 적용할 마이그레이션. 기본은 자동 수집한 전체 목록 */
  migrations?: readonly Migration[]
}

/**
 * SQLite 파일을 열고 마이그레이션까지 적용한다. Electron `app` 에 의존하지 않는다.
 * 메인 연결 단계에서 `join(app.getPath('userData'), 'gdesk.db')` 를 넘긴다. 테스트는 `':memory:'`.
 */
export function openDatabase(filePath: string, options: OpenDatabaseOptions = {}): DatabaseSync {
  const inMemory = filePath === ':memory:' || filePath === ''
  if (!inMemory) mkdirSync(dirname(filePath), { recursive: true })
  const db = new DatabaseSync(filePath)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    if (!inMemory) {
      db.exec('PRAGMA journal_mode = WAL')
      db.exec('PRAGMA synchronous = NORMAL')
    }
    runMigrations(db, options.migrations)
  } catch (err) {
    db.close()
    throw err
  }
  return db
}
