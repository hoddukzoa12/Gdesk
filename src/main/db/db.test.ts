import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from './connection'
import { closeDb, getDb, initDb, isDbReady } from './db'

describe('db getter', () => {
  afterEach(() => {
    closeDb()
  })

  it('초기화 전에는 getDb 가 오류를 던진다', () => {
    expect(isDbReady()).toBe(false)
    expect(() => getDb()).toThrow(/not initialized/)
  })

  it('initDb 로 넘긴 연결을 돌려준다', () => {
    const db = openDatabase(':memory:')
    initDb(db)
    expect(isDbReady()).toBe(true)
    expect(getDb()).toBe(db)
  })
})
