import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from './connection'
import {
  appliedMigrationIds,
  collectMigrations,
  migrationsFromModules,
  runMigrations,
  type Migration
} from './migrations'

describe('collectMigrations', () => {
  it('src/main/**/*.migration.ts 를 자동 수집하고 id 순으로 정렬한다', () => {
    const migrations = collectMigrations()
    const ids = migrations.map((m) => m.id)
    expect(ids).toContain('0001_core')
    expect([...ids].sort()).toEqual(ids)
  })
})

describe('migrationsFromModules', () => {
  const up = (): void => {}

  it('migration 하나 또는 migrations 배열을 모아 id 순으로 정렬한다', () => {
    const result = migrationsFromModules({
      './b.migration.ts': { migration: { id: '0200_b', up } },
      './a.migration.ts': {
        migrations: [
          { id: '0100_a', up },
          { id: '0300_c', up }
        ]
      }
    })
    expect(result.map((m) => m.id)).toEqual(['0100_a', '0200_b', '0300_c'])
  })

  it('중복 id 는 오류', () => {
    expect(() =>
      migrationsFromModules({
        './a.migration.ts': { migration: { id: '0100_a', up } },
        './b.migration.ts': { migration: { id: '0100_a', up } }
      })
    ).toThrow(/0100_a/)
  })

  it('migration 을 내보내지 않는 파일은 오류', () => {
    expect(() => migrationsFromModules({ './x.migration.ts': {} })).toThrow(/x\.migration\.ts/)
  })
})

describe('runMigrations', () => {
  it('각 마이그레이션을 한 번만 적용하고 기록한다', () => {
    const db = new DatabaseSync(':memory:')
    const up1 = vi.fn((d: DatabaseSync) => d.exec('CREATE TABLE t1 (x INTEGER)'))
    const up2 = vi.fn((d: DatabaseSync) => d.exec('CREATE TABLE t2 (x INTEGER)'))
    const list: Migration[] = [
      { id: '0002_two', up: up2 },
      { id: '0001_one', up: up1 }
    ]
    runMigrations(db, list)
    runMigrations(db, list)
    expect(up1).toHaveBeenCalledTimes(1)
    expect(up2).toHaveBeenCalledTimes(1)
    expect(appliedMigrationIds(db)).toEqual(['0001_one', '0002_two'])
    // 정렬된 순서로 적용
    expect(up1.mock.invocationCallOrder[0]).toBeLessThan(up2.mock.invocationCallOrder[0]!)
  })

  it('실패한 마이그레이션은 되돌리고 기록하지 않는다', () => {
    const db = new DatabaseSync(':memory:')
    const bad: Migration = {
      id: '0001_bad',
      up: (d) => {
        d.exec('CREATE TABLE half (x INTEGER)')
        throw new Error('boom')
      }
    }
    expect(() => runMigrations(db, [bad])).toThrow('boom')
    expect(appliedMigrationIds(db)).toEqual([])
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'half'")
      .get()
    expect(row).toBeUndefined()
  })

  it('나중에 추가된 마이그레이션만 새로 적용한다', () => {
    const db = new DatabaseSync(':memory:')
    const up1 = vi.fn()
    const up2 = vi.fn()
    runMigrations(db, [{ id: '0001_one', up: up1 }])
    runMigrations(db, [
      { id: '0001_one', up: up1 },
      { id: '0500_feature', up: up2 }
    ])
    expect(up1).toHaveBeenCalledTimes(1)
    expect(up2).toHaveBeenCalledTimes(1)
  })
})

describe('openDatabase', () => {
  it(':memory: 로 열고 핵심 테이블을 만든다', () => {
    const db = openDatabase(':memory:')
    expect(appliedMigrationIds(db)).toContain('0001_core')
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name)
    expect(tables).toEqual(
      expect.arrayContaining(['pins', 'local_links', 'settings', 'account_meta'])
    )
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    db.close()
  })
})
