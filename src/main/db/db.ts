import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from './connection'

/**
 * 앱 전체가 함께 쓰는 DB 연결. 메인 연결 단계에서 `setupDatabase(path)` (또는 `initDb(db)`)
 * 를 한 번 호출한다. 서비스·IPC 는 호출 시점에 `getDb()` 로 가져온다.
 */
let current: DatabaseSync | null = null

export function initDb(db: DatabaseSync): void {
  current = db
}

/** 파일을 열고 마이그레이션한 뒤 공용 연결로 등록한다. */
export function setupDatabase(filePath: string): DatabaseSync {
  const db = openDatabase(filePath)
  initDb(db)
  return db
}

export function isDbReady(): boolean {
  return current !== null
}

export function getDb(): DatabaseSync {
  if (current === null) throw new Error('Database is not initialized')
  return current
}

/** 공용 연결을 닫고 해제한다(앱 종료·테스트용). */
export function closeDb(): void {
  if (current === null) return
  const db = current
  current = null
  if (db.isOpen) db.close()
}
