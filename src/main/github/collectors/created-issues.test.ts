import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CACHE_TABLES, clearCache } from '../../cache/cleaner'
import {
  CREATED_ISSUE_GRACE_MS,
  forgetCreatedIssue,
  getIssueTabCounts,
  listMyIssues,
  recordCreatedIssue,
  replaceIssues
} from '../../cache/issues'
import { issueRecord } from '../../cache/test-fixtures'
import { openDatabase } from '../../db/connection'
import { OPERATIONS } from './queries'
import { refreshIssueLists } from './refresh'
import { fakeGitHub, rawIssue } from './test-server'

/**
 * 앱에서 만든 이슈(spec §6.3): GitHub 검색 반영이 늦어도 "내 이슈"에서 사라지지 않게 유예 시간 동안 남긴다.
 */
const CREATED_AT = Date.UTC(2026, 9, 16, 12)
const MINUTE = 60_000

function searchResponse(nodes: unknown[], issueCount = nodes.length) {
  return () => ({
    data: {
      viewer: { login: 'me' },
      search: { issueCount, pageInfo: { hasNextPage: false, endCursor: null }, nodes }
    }
  })
}

const created = issueRecord('I_new', 1, {
  number: 42,
  title: 'New bug',
  viewerIsAuthor: true,
  author: { login: 'me', avatarUrl: null, isBot: false },
  createdAt: '2026-10-16T12:00:00Z',
  updatedAt: '2026-10-16T12:00:00Z'
})

function pendingCount(db: DatabaseSync): number {
  return Number(
    (db.prepare('SELECT COUNT(*) AS n FROM cache_created_issues').get() as { n: number }).n
  )
}

function mineIds(db: DatabaseSync): string[] {
  return listMyIssues(db).items.map((i) => i.id)
}

describe('앱에서 만든 이슈의 유예(검색 반영 지연)', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  function client(nodes: unknown[]) {
    return fakeGitHub({
      graphql: {
        [OPERATIONS.assignedIssues]: searchResponse([]),
        [OPERATIONS.myIssues]: searchResponse(nodes)
      }
    }).client
  }

  it('cache_created_issues 는 정리 대상이다', () => {
    expect(CACHE_TABLES).toContain('cache_created_issues')
    recordCreatedIssue(db, created, CREATED_AT)
    clearCache(db)
    expect(pendingCount(db)).toBe(0)
  })

  it('만든 뒤 검색에 아직 없으면 목록 갱신 뒤에도 남는다(전체 수 포함)', async () => {
    replaceIssues(db, 'mine', [issueRecord('I_old', 1, { viewerIsAuthor: true })])
    recordCreatedIssue(db, created, CREATED_AT)
    expect(mineIds(db)).toEqual(['I_new', 'I_old'])

    const old = rawIssue('I_old', 1, { author: { __typename: 'User', login: 'me' } })
    await refreshIssueLists({ db, client: client([old]), now: CREATED_AT + MINUTE })
    expect(mineIds(db)).toEqual(['I_new', 'I_old'])
    expect(listMyIssues(db).items[0]).toMatchObject({ number: 42, title: 'New bug' })
    expect(getIssueTabCounts(db).mine).toBe(2)
    expect(pendingCount(db)).toBe(1)
  })

  it('유예 시간이 지나면 검색에 없는 만든 이슈는 빠지고 기록도 지운다', async () => {
    recordCreatedIssue(db, created, CREATED_AT)
    await refreshIssueLists({
      db,
      client: client([]),
      now: CREATED_AT + CREATED_ISSUE_GRACE_MS + 1
    })
    expect(mineIds(db)).toEqual([])
    expect(getIssueTabCounts(db).mine).toBe(0)
    expect(pendingCount(db)).toBe(0)
  })

  it('유예 시간은 조정할 수 있다', async () => {
    recordCreatedIssue(db, created, CREATED_AT)
    await refreshIssueLists({
      db,
      client: client([]),
      now: CREATED_AT + 2 * MINUTE,
      createdIssueGraceMs: MINUTE
    })
    expect(mineIds(db)).toEqual([])
  })

  it('검색에 나오면 중복 없이 검색 결과를 쓰고 기록을 지운다', async () => {
    recordCreatedIssue(db, created, CREATED_AT)
    const fromSearch = rawIssue('I_new', 1, {
      number: 42,
      title: 'New bug (edited)',
      author: { __typename: 'User', login: 'me' }
    })
    await refreshIssueLists({ db, client: client([fromSearch]), now: CREATED_AT + MINUTE })
    expect(mineIds(db)).toEqual(['I_new'])
    expect(listMyIssues(db).items[0]?.title).toBe('New bug (edited)')
    expect(getIssueTabCounts(db).mine).toBe(1)
    expect(pendingCount(db)).toBe(0)
    // 기록이 없으니 이후 검색에서 빠지면(닫힘 등) 목록에서도 빠진다
    await refreshIssueLists({ db, client: client([]), now: CREATED_AT + 2 * MINUTE })
    expect(mineIds(db)).toEqual([])
  })

  it('기록을 지우면(닫은 이슈) 다음 갱신에서 남기지 않는다', async () => {
    recordCreatedIssue(db, created, CREATED_AT)
    forgetCreatedIssue(db, 'I_new')
    await refreshIssueLists({ db, client: client([]), now: CREATED_AT + MINUTE })
    expect(mineIds(db)).toEqual([])
  })
})
