import type { DatabaseSync } from 'node:sqlite'
import { withTransaction } from './transaction'

/**
 * 스키마 마이그레이션. 기능마다 `src/main/<기능>/<이름>.migration.ts` 에서
 * `export const migration: Migration` (또는 `migrations: Migration[]`) 을 내보내면 자동 수집된다.
 *
 * id 는 전역에서 유일한 문자열이며 문자열 순서대로 적용한다.
 * 핵심 테이블은 `0001_core`, 기능 마이그레이션은 더 큰 접두사(예: `0100_cache`)를 쓴다.
 * 이미 배포된 마이그레이션은 고치지 말고 새 id 로 추가한다.
 */
export interface Migration {
  id: string
  up: (db: DatabaseSync) => void
}

export interface MigrationModule {
  migration?: Migration
  migrations?: readonly Migration[]
}

const MIGRATIONS_TABLE = 'schema_migrations'

function isMigration(value: unknown): value is Migration {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Record<string, unknown>
  return typeof m.id === 'string' && m.id.length > 0 && typeof m.up === 'function'
}

/** 모듈 목록에서 마이그레이션을 모아 검사하고 id 순으로 정렬한다. */
export function migrationsFromModules(
  modules: Record<string, MigrationModule | Record<string, unknown>>
): Migration[] {
  const result: Migration[] = []
  const seen = new Map<string, string>()
  for (const [file, mod] of Object.entries(modules)) {
    const m = mod as MigrationModule
    const found: unknown[] = []
    if (m.migration !== undefined) found.push(m.migration)
    if (m.migrations !== undefined) found.push(...m.migrations)
    if (found.length === 0) {
      throw new Error(`Migration file ${file} exports no "migration" or "migrations"`)
    }
    for (const item of found) {
      if (!isMigration(item)) throw new Error(`Invalid migration exported from ${file}`)
      const prev = seen.get(item.id)
      if (prev !== undefined) {
        throw new Error(`Duplicate migration id "${item.id}" in ${prev} and ${file}`)
      }
      seen.set(item.id, file)
      result.push(item)
    }
  }
  return sortMigrations(result)
}

function sortMigrations(list: readonly Migration[]): Migration[] {
  return [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** `src/main/**\/*.migration.ts` 를 자동 수집한다. */
export function collectMigrations(): Migration[] {
  const modules = import.meta.glob<MigrationModule>('../**/*.migration.ts', { eager: true })
  return migrationsFromModules(modules)
}

function ensureMigrationsTable(db: DatabaseSync): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )`
  )
}

/** 적용된 마이그레이션 id (정렬됨) */
export function appliedMigrationIds(db: DatabaseSync): string[] {
  ensureMigrationsTable(db)
  return db
    .prepare(`SELECT id FROM ${MIGRATIONS_TABLE} ORDER BY id`)
    .all()
    .map((row) => String(row.id))
}

/**
 * 아직 적용하지 않은 마이그레이션을 id 순으로 하나씩 트랜잭션 안에서 적용한다.
 * 실패하면 그 마이그레이션은 되돌리고 오류를 던진다(앞서 적용한 것은 남는다).
 */
export function runMigrations(
  db: DatabaseSync,
  migrations: readonly Migration[] = collectMigrations()
): string[] {
  const ordered = sortMigrations(migrations)
  const ids = new Set<string>()
  for (const m of ordered) {
    if (ids.has(m.id)) throw new Error(`Duplicate migration id "${m.id}"`)
    ids.add(m.id)
  }
  const applied = new Set(appliedMigrationIds(db))
  const newlyApplied: string[] = []
  const record = db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (?, ?)`)
  for (const m of ordered) {
    if (applied.has(m.id)) continue
    withTransaction(db, () => {
      m.up(db)
      record.run(m.id, Date.now())
    })
    newlyApplied.push(m.id)
  }
  return newlyApplied
}
