import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../db/connection'
import { listPins, onPinsChanged, pinRepo, reorderPins, unpinRepo } from './pins.service'

describe('pins service', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = openDatabase(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  const ids = (): number[] => listPins(db).map((p) => p.repoId)

  it('끝에 덧붙이고 위치를 0 부터 매긴다', () => {
    pinRepo(db, 30)
    pinRepo(db, 10)
    pinRepo(db, 20)
    expect(listPins(db)).toEqual([
      { repoId: 30, position: 0 },
      { repoId: 10, position: 1 },
      { repoId: 20, position: 2 }
    ])
  })

  it('이미 고정한 저장소는 중복으로 넣지 않는다', () => {
    pinRepo(db, 1)
    pinRepo(db, 2)
    pinRepo(db, 1)
    expect(ids()).toEqual([1, 2])
  })

  it('고정 해제 후 위치를 다시 매긴다', () => {
    pinRepo(db, 1)
    pinRepo(db, 2)
    pinRepo(db, 3)
    unpinRepo(db, 2)
    expect(listPins(db)).toEqual([
      { repoId: 1, position: 0 },
      { repoId: 3, position: 1 }
    ])
    unpinRepo(db, 999)
    expect(ids()).toEqual([1, 3])
    pinRepo(db, 4)
    expect(listPins(db).at(-1)).toEqual({ repoId: 4, position: 2 })
  })

  it('전체 순서 목록으로 순서를 바꾼다', () => {
    pinRepo(db, 1)
    pinRepo(db, 2)
    pinRepo(db, 3)
    expect(reorderPins(db, [3, 1, 2])).toEqual([
      { repoId: 3, position: 0 },
      { repoId: 1, position: 1 },
      { repoId: 2, position: 2 }
    ])
    expect(ids()).toEqual([3, 1, 2])
  })

  it('현재 고정 목록과 다른 순서 목록은 거부한다', () => {
    pinRepo(db, 1)
    pinRepo(db, 2)
    expect(() => reorderPins(db, [1])).toThrow()
    expect(() => reorderPins(db, [1, 2, 3])).toThrow()
    expect(() => reorderPins(db, [1, 1])).toThrow()
    expect(() => reorderPins(db, [2, 3])).toThrow()
    expect(ids()).toEqual([1, 2])
  })

  it('잘못된 저장소 ID 는 거부한다', () => {
    expect(() => pinRepo(db, 0)).toThrow()
    expect(() => pinRepo(db, 1.5)).toThrow()
    expect(() => pinRepo(db, Number.NaN)).toThrow()
  })

  it('바뀐 경우에만 변경 알림을 보낸다', () => {
    const listener = vi.fn()
    const off = onPinsChanged(listener)
    pinRepo(db, 1)
    pinRepo(db, 1)
    unpinRepo(db, 999)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith([{ repoId: 1, position: 0 }])
    pinRepo(db, 2)
    reorderPins(db, [2, 1])
    unpinRepo(db, 1)
    expect(listener).toHaveBeenCalledTimes(4)
    off()
    pinRepo(db, 3)
    expect(listener).toHaveBeenCalledTimes(4)
  })
})
