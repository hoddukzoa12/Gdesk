import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/connection'
import { CACHE_TABLES } from './cleaner'
import {
  ISSUE_DETAIL_CACHE_LIMIT,
  getIssueDetail,
  lookupRepoFullName,
  patchIssueDetail,
  restoreIssueDetail,
  saveIssueDetail
} from './issue-details'
import { addIssueToScope, getIssueTabCounts, listMyIssues, replaceIssues } from './issues'
import { markRepositoryUnavailable, replaceMyRepositories } from './repositories'
import { issueRecord, repoRecord } from './test-fixtures'
import type { IssueDetailRecord } from './types'

const NOW = Date.UTC(2026, 9, 16, 12)

function detail(repoId: number, number: number, patch: Partial<IssueDetailRecord> = {}) {
  return {
    id: `I_${repoId}_${number}`,
    repoId,
    repoFullName: `me/repo${repoId}`,
    number,
    url: `https://github.com/me/repo${repoId}/issues/${number}`,
    title: `Issue ${number}`,
    state: 'open',
    stateReason: null,
    author: { login: 'a', avatarUrl: null, isBot: false },
    createdAt: '2026-10-01T00:00:00Z',
    bodyHTML: '<p>x</p>',
    labels: [{ name: 'bug', color: 'd73a4a' }],
    assignees: [],
    reactions: [{ content: 'HEART', count: 2, viewerHasReacted: true }],
    comments: [],
    commentCount: 0,
    linkedPullRequests: [],
    referencingCommits: [],
    locked: false,
    viewerCanClose: true,
    viewerCanReopen: false,
    viewerCanReact: true,
    viewerPermission: 'TRIAGE',
    ...patch
  } satisfies IssueDetailRecord
}

describe('이슈 상세 캐시', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('cache_issue_details 는 정리 대상이다', () => {
    expect(CACHE_TABLES).toContain('cache_issue_details')
  })

  it('받은 적 없으면 null, 저장하면 코멘트 가능 여부와 받은 시각을 붙여 읽는다', () => {
    expect(getIssueDetail(db, 1, 1)).toBeNull()
    saveIssueDetail(db, detail(1, 1), NOW)
    expect(getIssueDetail(db, 1, 1)).toEqual({
      ...detail(1, 1),
      viewerCanComment: true,
      fetchedAt: NOW
    })
    saveIssueDetail(db, detail(1, 1, { locked: true, title: 'new' }), NOW + 5)
    expect(getIssueDetail(db, 1, 1)).toMatchObject({
      title: 'new',
      viewerCanComment: false,
      fetchedAt: NOW + 5
    })
    expect(getIssueDetail(db, 1, 2)).toBeNull()
  })

  it('망가진 행은 null 로 읽는다', () => {
    db.prepare(
      'INSERT INTO cache_issue_details (repo_id, number, data, fetched_at) VALUES (?, ?, ?, ?)'
    ).run(3, 3, '{not json', NOW)
    expect(getIssueDetail(db, 3, 3)).toBeNull()
  })

  it('오래 본 상세부터 지워 상한을 지킨다', () => {
    for (let i = 1; i <= ISSUE_DETAIL_CACHE_LIMIT + 2; i++) {
      saveIssueDetail(db, detail(1, i), NOW + i)
    }
    const n = db.prepare('SELECT COUNT(*) AS n FROM cache_issue_details').get()
    expect(n).toEqual({ n: ISSUE_DETAIL_CACHE_LIMIT })
    expect(getIssueDetail(db, 1, 1)).toBeNull()
    expect(getIssueDetail(db, 1, 2)).toBeNull()
    expect(getIssueDetail(db, 1, 3)).not.toBeNull()
  })

  it('저장소 이름: 저장소 행 → 이슈 행 → 모름', () => {
    replaceMyRepositories(db, [repoRecord(1, { owner: 'o', name: 'a' })])
    replaceIssues(db, 'assigned', [issueRecord('I', 2, { repoFullName: 'x/y' })])
    // 접근 불가로만 알려진 저장소는 이름이 빈 자리 행이다
    markRepositoryUnavailable(db, 3, NOW)
    expect(lookupRepoFullName(db, 1)).toBe('o/a')
    expect(lookupRepoFullName(db, 2)).toBe('x/y')
    expect(lookupRepoFullName(db, 3)).toBeNull()
    expect(lookupRepoFullName(db, 4)).toBeNull()
  })
})

describe('이슈 상세 부분 변경(쓰기 동작)', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  const raw = () =>
    db.prepare('SELECT data, fetched_at FROM cache_issue_details').all() as {
      data: string
      fetched_at: number
    }[]

  it('data 만 바꾸고 받은 시각은 그대로, 되돌리면 원문과 같다', () => {
    saveIssueDetail(db, detail(1, 1), NOW)
    const before = raw()
    const snapshot = patchIssueDetail(db, 1, 1, (r) => ({ ...r, state: 'closed' }))
    expect(snapshot).not.toBeNull()
    expect(getIssueDetail(db, 1, 1)).toMatchObject({ state: 'closed', fetchedAt: NOW })
    expect(restoreIssueDetail(db, snapshot!, () => true)).toBe(true)
    expect(raw()).toEqual(before)
  })

  it('없는 상세나 mutate 가 null 이면 바꾸지 않고 null', () => {
    expect(patchIssueDetail(db, 1, 1, (r) => r)).toBeNull()
    saveIssueDetail(db, detail(1, 1), NOW)
    const before = raw()
    expect(patchIssueDetail(db, 1, 1, () => null)).toBeNull()
    expect(raw()).toEqual(before)
  })

  it('되돌리기는 그사이 지워진 행을 다시 만들지 않는다(로그아웃 등)', () => {
    saveIssueDetail(db, detail(1, 1), NOW)
    const snapshot = patchIssueDetail(db, 1, 1, (r) => ({ ...r, title: 'x' }))
    db.exec('DELETE FROM cache_issue_details')
    restoreIssueDetail(db, snapshot!, () => true)
    expect(raw()).toEqual([])
  })

  it('데이터 세대가 바뀌었으면(로그아웃·계정 전환) 되돌리지 않는다', () => {
    saveIssueDetail(db, detail(1, 1), NOW)
    const snapshot = patchIssueDetail(db, 1, 1, (r) => ({ ...r, title: 'x' }))
    // 다른 계정으로 다시 받은 상세
    saveIssueDetail(db, detail(1, 1, { title: 'other account' }), NOW)
    const after = raw()
    expect(restoreIssueDetail(db, snapshot!, () => false)).toBe(false)
    expect(raw()).toEqual(after)
  })
})

describe('목록에 이슈 한 개 더하기', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('다른 항목은 두고 더하며, 처음 들어갈 때만 전체 수를 늘린다', () => {
    replaceIssues(db, 'mine', [issueRecord('I_a', 1, { viewerIsAuthor: true })], { totalCount: 3 })
    const added = issueRecord('I_b', 1, {
      viewerIsAuthor: true,
      updatedAt: '2026-10-16T00:00:00Z'
    })
    addIssueToScope(db, 'mine', added)
    addIssueToScope(db, 'mine', added)
    expect(listMyIssues(db).items.map((i) => i.id)).toEqual(['I_b', 'I_a'])
    expect(getIssueTabCounts(db).mine).toBe(4)
  })
})
