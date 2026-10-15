import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/connection'
import {
  listAssignedIssues,
  listIncomingIssues,
  listMyIssues,
  listRepoIssues,
  replaceIssues,
  replaceRepoIssues
} from './issues'
import {
  countIncomingPullRequests,
  countReviewRequests,
  listIncomingPullRequests,
  listMyPullRequests,
  listMyPullRequestsInRepo,
  listRepoPullRequests,
  listReviewRequests,
  replacePullRequests,
  replaceRepoPullRequests
} from './pull-requests'
import { replaceMyRepositories, upsertRepositories } from './repositories'
import { issueRecord, prRecord, repoRecord } from './test-fixtures'

describe('PR 캐시', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
    replaceMyRepositories(db, [repoRecord(1), repoRecord(2)])
    upsertRepositories(db, [repoRecord(9, { owner: 'other' })])
  })
  afterEach(() => db.close())

  it('들어온 PR = 내 저장소의 열린 PR 중 내가 쓰지 않은 것, 최근 갱신 순', () => {
    replaceRepoPullRequests(db, 1, [
      prRecord('a', 1, { updatedAt: '2026-10-01T00:00:00Z' }),
      prRecord('mine', 1, {
        viewerIsAuthor: true,
        author: { login: 'me', avatarUrl: null, isBot: false }
      })
    ])
    replaceRepoPullRequests(db, 2, [prRecord('b', 2, { updatedAt: '2026-10-05T00:00:00Z' })])
    // 내 집합 밖 저장소의 PR 은 들어온 PR 이 아니다
    replaceRepoPullRequests(db, 9, [prRecord('x', 9)])
    expect(listIncomingPullRequests(db).map((p) => p.id)).toEqual(['b', 'a'])
    expect(countIncomingPullRequests(db)).toBe(2)
  })

  it('저장소 범위를 다시 쓰면 닫힌 PR 은 빠지고 다른 범위는 남는다', () => {
    replaceRepoPullRequests(db, 1, [prRecord('a', 1), prRecord('b', 1)])
    replacePullRequests(db, 'review_requested', [prRecord('b', 1)])
    replaceRepoPullRequests(db, 1, [prRecord('a', 1, { title: 'renamed' })])
    expect(listIncomingPullRequests(db).map((p) => p.id)).toEqual(['a'])
    expect(listIncomingPullRequests(db)[0]?.title).toBe('renamed')
    // b 는 리뷰 요청 범위에 남아 있다
    expect(listReviewRequests(db).map((p) => p.id)).toEqual(['b'])
    expect(countReviewRequests(db)).toBe(1)
    replacePullRequests(db, 'review_requested', [])
    expect(listReviewRequests(db)).toEqual([])
    // 어디에도 속하지 않는 행은 지운다
    const n = db.prepare('SELECT COUNT(*) AS n FROM cache_pull_requests').get()
    expect(Number(n?.n)).toBe(1)
  })

  it('내가 올린 PR 과 저장소별 목록', () => {
    const mine = prRecord('m1', 9, {
      viewerIsAuthor: true,
      state: 'draft',
      ciStatus: 'failing',
      reviewStatus: 'approved'
    })
    replacePullRequests(db, 'mine', [mine])
    expect(listMyPullRequests(db)).toEqual([
      {
        id: 'm1',
        repoId: 9,
        repoFullName: 'me/repo9',
        number: 1,
        title: 'PR m1',
        url: 'https://github.com/me/repo9/pull/1',
        author: { login: 'someone', avatarUrl: null, isBot: false },
        state: 'draft',
        reviewStatus: 'approved',
        ciStatus: 'failing',
        commentCount: 0,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z'
      }
    ])
    replaceRepoPullRequests(db, 9, [prRecord('o', 9)])
    expect(listRepoPullRequests(db, 9).map((p) => p.id)).toEqual(['o'])
    expect(listMyPullRequestsInRepo(db, 9).map((p) => p.id)).toEqual(['m1'])
  })
})

describe('이슈 캐시', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
    replaceMyRepositories(db, [repoRecord(1)])
  })
  afterEach(() => db.close())

  it('들어온·할당·내 이슈 범위를 따로 돌려준다', () => {
    replaceRepoIssues(db, 1, [
      issueRecord('i1', 1, { labels: [{ name: 'bug', color: 'ff0000' }], commentCount: 3 }),
      issueRecord('i2', 1, { viewerIsAuthor: true })
    ])
    replaceIssues(db, 'assigned', [issueRecord('a1', 5)])
    replaceIssues(db, 'mine', [issueRecord('i2', 1, { viewerIsAuthor: true })])
    expect(listIncomingIssues(db).map((i) => i.id)).toEqual(['i1'])
    expect(listIncomingIssues(db)[0]).toMatchObject({
      labels: [{ name: 'bug', color: 'ff0000' }],
      commentCount: 3
    })
    expect(listAssignedIssues(db).map((i) => i.id)).toEqual(['a1'])
    expect(listMyIssues(db).map((i) => i.id)).toEqual(['i2'])
    expect(listRepoIssues(db, 1).map((i) => i.id)).toEqual(['i1', 'i2'])
  })

  it('PR 은 이슈 목록에 섞이지 않는다', () => {
    replaceRepoPullRequests(db, 1, [prRecord('p1', 1)])
    replaceRepoIssues(db, 1, [issueRecord('i1', 1)])
    expect(listIncomingIssues(db).map((i) => i.id)).toEqual(['i1'])
    expect(listRepoIssues(db, 1).map((i) => i.id)).toEqual(['i1'])
  })
})
