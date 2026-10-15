import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/connection'
import {
  getRepository,
  getRepositoryAccessStatuses,
  listMyRepositories,
  listMyRepositoryOwners,
  listStarredRepositories,
  replaceMyRepositories,
  replaceStarredRepositories,
  restoreStarred,
  setRepositoryAccessStatus,
  setStarred,
  upsertRepositories
} from './repositories'
import { repoRecord } from './test-fixtures'

describe('저장소 캐시', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('이름이 바뀌거나 옮겨진 저장소는 같은 ID 행을 갱신한다', () => {
    replaceMyRepositories(db, [repoRecord(1, { owner: 'me', name: 'old' })])
    replaceMyRepositories(db, [
      repoRecord(1, { owner: 'acme', name: 'new', ownerType: 'Organization' })
    ])
    const count = db.prepare('SELECT COUNT(*) AS n FROM cache_repositories').get()
    expect(Number(count?.n)).toBe(1)
    expect(getRepository(db, 1)).toMatchObject({
      id: 1,
      owner: 'acme',
      name: 'new',
      fullName: 'acme/new',
      ownerType: 'Organization',
      isMine: true,
      accessStatus: 'available'
    })
  })

  it('필드를 그대로 읽어 온다', () => {
    upsertRepositories(db, [
      repoRecord(5, {
        private: true,
        fork: true,
        archived: true,
        topics: ['a', 'b'],
        description: 'desc',
        viewerPermission: 'WRITE',
        viewerHasStarred: true
      })
    ])
    expect(getRepository(db, 5)).toMatchObject({
      private: true,
      fork: true,
      archived: true,
      topics: ['a', 'b'],
      description: 'desc',
      viewerPermission: 'WRITE',
      viewerHasStarred: true,
      isMine: false,
      starredAt: null
    })
    expect(getRepository(db, 999)).toBeNull()
  })

  describe('listMyRepositories', () => {
    beforeEach(() => {
      replaceMyRepositories(db, [
        repoRecord(1, { name: 'alpha', pushedAt: '2026-10-03T00:00:00Z', stargazerCount: 5 }),
        repoRecord(2, { name: 'beta', fork: true, pushedAt: '2026-10-04T00:00:00Z' }),
        repoRecord(3, { name: 'gamma', archived: true, pushedAt: '2026-10-05T00:00:00Z' }),
        repoRecord(4, {
          owner: 'acme',
          ownerType: 'Organization',
          name: 'delta',
          pushedAt: '2026-10-02T00:00:00Z',
          stargazerCount: 50
        })
      ])
      // 내 집합 밖(스타만 한 저장소)
      upsertRepositories(db, [repoRecord(9, { owner: 'other', name: 'zeta' })])
    })

    it.each([
      [{}, [1, 4]],
      [{ includeForks: true }, [2, 1, 4]],
      [{ includeArchived: true }, [3, 1, 4]],
      [{ includeForks: true, includeArchived: true }, [3, 2, 1, 4]],
      [{ owner: 'acme' }, [4]],
      [{ sort: 'name' }, [1, 4]],
      [{ sort: 'stars' }, [4, 1]],
      [{ search: 'DEL' }, [4]],
      [{ limit: 1 }, [1]]
    ] as const)('%o → %o', (options, ids) => {
      expect(listMyRepositories(db, options).map((r) => r.id)).toEqual(ids)
    })

    it('소유자 목록', () => {
      expect(listMyRepositoryOwners(db)).toEqual([
        { login: 'acme', type: 'Organization', count: 1 },
        { login: 'me', type: 'User', count: 3 }
      ])
    })
  })

  it('내 집합에서 빠지면 isMine=false, 확인 결과가 unavailable 이면 표시한다', () => {
    replaceMyRepositories(db, [repoRecord(1), repoRecord(2), repoRecord(3)])
    replaceMyRepositories(db, [repoRecord(1)], {
      accessStatuses: new Map([[2, 'unavailable']])
    })
    expect(getRepository(db, 2)).toMatchObject({ isMine: false, accessStatus: 'unavailable' })
    expect(getRepository(db, 3)).toMatchObject({ isMine: false, accessStatus: 'available' })
    expect(getRepositoryAccessStatuses(db, [1, 2, 3, 77])).toEqual({
      1: 'available',
      2: 'unavailable',
      3: 'available'
    })
    // 다시 받아지면 available
    upsertRepositories(db, [repoRecord(2)])
    expect(getRepository(db, 2)?.accessStatus).toBe('available')
    expect(setRepositoryAccessStatus(db, 2, 'unavailable')).toBe(true)
    expect(getRepository(db, 2)?.accessStatus).toBe('unavailable')
  })

  it('빠진 저장소의 확인 결과가 available 이면 이전 unavailable 표시를 푼다, 집합에 남은 것은 무시', () => {
    replaceMyRepositories(db, [repoRecord(1), repoRecord(2)])
    setRepositoryAccessStatus(db, 2, 'unavailable')
    replaceMyRepositories(db, [repoRecord(1)], {
      accessStatuses: new Map([
        [2, 'available'],
        [1, 'unavailable']
      ])
    })
    expect(getRepository(db, 2)).toMatchObject({ isMine: false, accessStatus: 'available' })
    expect(getRepository(db, 1)).toMatchObject({ isMine: true, accessStatus: 'available' })
  })

  it('스타 목록 쓰기는 isMine 을 건드리지 않고, 내 저장소 쓰기는 starredAt 을 지우지 않는다', () => {
    replaceMyRepositories(db, [repoRecord(1)])
    replaceStarredRepositories(db, [
      { repository: repoRecord(1), starredAt: '2026-10-02T00:00:00Z' },
      { repository: repoRecord(8, { owner: 'x' }), starredAt: '2026-10-05T00:00:00Z' }
    ])
    // 머리글의 viewerHasStarred 는 GitHub 의 최신 값이다
    replaceMyRepositories(db, [repoRecord(1, { viewerHasStarred: true })])
    expect(getRepository(db, 1)).toMatchObject({
      isMine: true,
      viewerHasStarred: true,
      starredAt: '2026-10-02T00:00:00Z'
    })
    expect(listStarredRepositories(db).map((r) => r.id)).toEqual([8, 1])
    expect(listStarredRepositories(db, { search: 'x/' }).map((r) => r.id)).toEqual([8])

    // 스타 해제된 저장소는 목록에서 빠진다
    replaceStarredRepositories(db, [
      { repository: repoRecord(8, { owner: 'x' }), starredAt: '2026-10-05T00:00:00Z' }
    ])
    expect(getRepository(db, 1)).toMatchObject({
      viewerHasStarred: false,
      starredAt: null,
      isMine: true
    })
    expect(listStarredRepositories(db).map((r) => r.id)).toEqual([8])
  })

  it('setStarred 는 이전 값을 돌려주고 restoreStarred 로 되돌린다', () => {
    upsertRepositories(db, [repoRecord(1, { stargazerCount: 10 })])
    const prev = setStarred(db, 1, true, Date.UTC(2026, 9, 15))
    expect(prev).toEqual({
      repoId: 1,
      viewerHasStarred: false,
      starredAt: null,
      stargazerCount: 10
    })
    expect(getRepository(db, 1)).toMatchObject({
      viewerHasStarred: true,
      stargazerCount: 11,
      starredAt: '2026-10-15T00:00:00.000Z'
    })
    expect(listStarredRepositories(db).map((r) => r.id)).toEqual([1])
    // 같은 값으로 다시 누르면 수는 그대로
    setStarred(db, 1, true)
    expect(getRepository(db, 1)?.stargazerCount).toBe(11)

    restoreStarred(db, prev!)
    expect(getRepository(db, 1)).toMatchObject({
      viewerHasStarred: false,
      stargazerCount: 10,
      starredAt: null
    })

    const unstar = setStarred(db, 1, false)
    expect(unstar?.viewerHasStarred).toBe(false)
    expect(getRepository(db, 1)?.stargazerCount).toBe(10)
    expect(setStarred(db, 404, true)).toBeNull()
  })

  it('스타 해제는 수를 줄이고 0 아래로 내려가지 않는다', () => {
    upsertRepositories(db, [repoRecord(1, { stargazerCount: 0, viewerHasStarred: true })])
    setStarred(db, 1, false)
    expect(getRepository(db, 1)).toMatchObject({ viewerHasStarred: false, stargazerCount: 0 })
  })
})
