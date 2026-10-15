import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLastUserId, isDifferentAccount, setLastUserId } from './account-meta'
import {
  clearAccountData,
  clearFetchedData,
  currentDataGuard,
  onAccountDataCleared,
  registerFetchedDataCleaner,
  resetFetchedDataCleaners
} from './cleanup'
import { openDatabase } from './connection'
import { addLink, listAllLinks } from './links'
import { listPins, pinRepo } from '../pins/pins.service'
import { getSettings, updateSettings } from '../settings/settings.service'

describe('계정 단위 삭제', () => {
  let db: DatabaseSync
  const home = '/home/tester'

  beforeEach(() => {
    db = openDatabase(':memory:')
    db.exec('CREATE TABLE fake_cache (x INTEGER)')
    db.exec('INSERT INTO fake_cache VALUES (1), (2)')
    pinRepo(db, 10)
    pinRepo(db, 20)
    addLink(db, 10, '/gdesk-nonexistent/a', { platform: 'linux' })
    updateSettings(
      db,
      {
        theme: 'dark',
        language: 'ko',
        cloneProtocol: 'ssh',
        cloneBaseDir: '/work/code',
        defaultEditor: 'vscode',
        homeCards: [{ id: 'a', enabled: false }]
      },
      home
    )
    setLastUserId(db, 4242)
  })

  afterEach(() => {
    resetFetchedDataCleaners()
    db.close()
  })

  const cacheRows = (): number =>
    Number((db.prepare('SELECT COUNT(*) AS n FROM fake_cache').get() as { n: number }).n)

  it('clearFetchedData: 정리 함수만 실행하고 고정·연결·설정·계정 정보는 남긴다', () => {
    const cleaner = vi.fn((d: DatabaseSync) => d.exec('DELETE FROM fake_cache'))
    registerFetchedDataCleaner(cleaner)
    const settingsBefore = getSettings(db, home)

    clearFetchedData(db)

    expect(cleaner).toHaveBeenCalledTimes(1)
    expect(cleaner).toHaveBeenCalledWith(db)
    expect(cacheRows()).toBe(0)
    expect(listPins(db)).toHaveLength(2)
    expect(listAllLinks(db)).toHaveLength(1)
    expect(getSettings(db, home)).toEqual(settingsBefore)
    expect(getLastUserId(db)).toBe(4242)
  })

  it('clearAccountData: 정리 함수 + 고정·연결 삭제, 설정과 계정 정보는 남긴다', () => {
    const cleaner = vi.fn((d: DatabaseSync) => d.exec('DELETE FROM fake_cache'))
    registerFetchedDataCleaner(cleaner)
    const cleared = vi.fn()
    const off = onAccountDataCleared(cleared)
    const settingsBefore = getSettings(db, home)

    clearAccountData(db)

    expect(cleaner).toHaveBeenCalledTimes(1)
    expect(cacheRows()).toBe(0)
    expect(listPins(db)).toEqual([])
    expect(listAllLinks(db)).toEqual([])
    expect(getSettings(db, home)).toEqual(settingsBefore)
    expect(getSettings(db, home)).toMatchObject({ theme: 'dark', language: 'ko' })
    expect(getLastUserId(db)).toBe(4242)
    expect(cleared).toHaveBeenCalledTimes(1)
    off()
  })

  it('로그아웃·계정 전환 전에 잡은 세대 확인은 지운 뒤 false 가 된다', () => {
    const beforeLogout = currentDataGuard()
    expect(beforeLogout()).toBe(true)
    clearFetchedData(db)
    expect(beforeLogout()).toBe(false)
    const beforeSwitch = currentDataGuard()
    expect(beforeSwitch()).toBe(true)
    clearAccountData(db)
    expect(beforeSwitch()).toBe(false)
    expect(currentDataGuard()()).toBe(true)
  })

  it('등록 해제한 정리 함수는 실행하지 않는다', () => {
    const cleaner = vi.fn()
    const off = registerFetchedDataCleaner(cleaner)
    off()
    clearFetchedData(db)
    expect(cleaner).not.toHaveBeenCalled()
  })

  it('정리 함수가 실패하면 전체를 되돌린다', () => {
    registerFetchedDataCleaner((d) => d.exec('DELETE FROM fake_cache'))
    registerFetchedDataCleaner(() => {
      throw new Error('cleaner failed')
    })
    expect(() => clearAccountData(db)).toThrow('cleaner failed')
    expect(cacheRows()).toBe(2)
    expect(listPins(db)).toHaveLength(2)
    expect(listAllLinks(db)).toHaveLength(1)
  })
})

describe('account meta', () => {
  it('마지막 로그인 사용자 ID 를 저장하고 다른 계정인지 판정한다', () => {
    const db = openDatabase(':memory:')
    expect(getLastUserId(db)).toBeNull()
    expect(isDifferentAccount(db, 1)).toBe(false)
    setLastUserId(db, 1)
    expect(getLastUserId(db)).toBe(1)
    expect(isDifferentAccount(db, 1)).toBe(false)
    expect(isDifferentAccount(db, 2)).toBe(true)
    setLastUserId(db, 2)
    expect(getLastUserId(db)).toBe(2)
    db.close()
  })

  it('잘못된 사용자 ID 는 거부한다', () => {
    const db = openDatabase(':memory:')
    expect(() => setLastUserId(db, -1)).toThrow()
    expect(() => setLastUserId(db, 1.5)).toThrow()
    db.close()
  })
})
