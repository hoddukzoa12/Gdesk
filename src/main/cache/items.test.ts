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
    expect(listIncomingPullRequests(db).items.map((p) => p.id)).toEqual(['b', 'a'])
    expect(countIncomingPullRequests(db)).toBe(2)
  })

  it('저장소 범위를 다시 쓰면 닫힌 PR 은 빠지고 다른 범위는 남는다', () => {
    replaceRepoPullRequests(db, 1, [prRecord('a', 1), prRecord('b', 1)])
    replacePullRequests(db, 'review_requested', [prRecord('b', 1)])
    replaceRepoPullRequests(db, 1, [prRecord('a', 1, { title: 'renamed' })])
    expect(listIncomingPullRequests(db).items.map((p) => p.id)).toEqual(['a'])
    expect(listIncomingPullRequests(db).items[0]?.title).toBe('renamed')
    // b 는 리뷰 요청 범위에 남아 있다
    expect(listReviewRequests(db).items.map((p) => p.id)).toEqual(['b'])
    expect(countReviewRequests(db)).toBe(1)
    replacePullRequests(db, 'review_requested', [])
    expect(listReviewRequests(db).items).toEqual([])
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
    expect(listMyPullRequests(db).items).toEqual([
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
    expect(listRepoPullRequests(db, 9).items.map((p) => p.id)).toEqual(['o'])
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
    expect(listIncomingIssues(db).items.map((i) => i.id)).toEqual(['i1'])
    expect(listIncomingIssues(db).items[0]).toMatchObject({
      labels: [{ name: 'bug', color: 'ff0000' }],
      commentCount: 3
    })
    expect(listAssignedIssues(db).items.map((i) => i.id)).toEqual(['a1'])
    expect(listMyIssues(db).items.map((i) => i.id)).toEqual(['i2'])
    expect(listRepoIssues(db, 1).items.map((i) => i.id)).toEqual(['i1', 'i2'])
  })

  it('PR 은 이슈 목록에 섞이지 않는다', () => {
    replaceRepoPullRequests(db, 1, [prRecord('p1', 1)])
    replaceRepoIssues(db, 1, [issueRecord('i1', 1)])
    expect(listIncomingIssues(db).items.map((i) => i.id)).toEqual(['i1'])
    expect(listRepoIssues(db, 1).items.map((i) => i.id)).toEqual(['i1'])
  })
})

describe('목록 수치와 완전성', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
    replaceMyRepositories(db, [
      repoRecord(1, { openPullRequestCount: 5, openIssueCount: 2 }),
      repoRecord(2, { openPullRequestCount: 3, openIssueCount: 0 })
    ])
  })
  afterEach(() => db.close())

  it('들어온 PR 수는 저장소의 전체 열린 수에서 내 PR 을 뺀 값(목록 상한에 잘리지 않음)', () => {
    // 저장소 1: 5개 중 2개만 받음(잘림). 그중 하나는 내 PR
    replaceRepoPullRequests(db, 1, [prRecord('a', 1), prRecord('m', 1, { viewerIsAuthor: true })], {
      totalCount: 5
    })
    // 저장소 2: 아직 받지 않음 → 저장소 머리글의 열린 수(3)
    const page = listIncomingPullRequests(db)
    expect(page.items.map((p) => p.id)).toEqual(['a'])
    expect(page.totalCount).toBe(4 + 3)
    expect(page.complete).toBe(false)
    expect(countIncomingPullRequests(db)).toBe(7)
  })

  it('모두 받은 저장소는 받은 행으로 정확히 센다', () => {
    replaceRepoPullRequests(db, 1, [prRecord('a', 1), prRecord('b', 1)], { totalCount: 2 })
    replaceRepoPullRequests(db, 2, [prRecord('c', 2, { viewerIsAuthor: true })], { totalCount: 1 })
    const page = listIncomingPullRequests(db)
    expect(page).toMatchObject({ totalCount: 2, complete: true })
  })

  it('들어온 이슈 수도 같은 규칙', () => {
    replaceRepoIssues(db, 1, [issueRecord('i', 1)], { totalCount: 2 })
    expect(listIncomingIssues(db)).toMatchObject({ totalCount: 2, complete: false })
    replaceRepoIssues(db, 1, [issueRecord('i', 1), issueRecord('j', 1)], { totalCount: 2 })
    expect(listIncomingIssues(db)).toMatchObject({ totalCount: 2, complete: true })
  })

  it('검색 목록 수는 검색 결과 총수(issueCount)', () => {
    replacePullRequests(db, 'review_requested', [prRecord('r', 9)], { totalCount: 120 })
    expect(listReviewRequests(db)).toMatchObject({ totalCount: 120, complete: false })
    expect(countReviewRequests(db)).toBe(120)
    replaceIssues(db, 'assigned', [issueRecord('x', 9)])
    expect(listAssignedIssues(db)).toMatchObject({ totalCount: 1, complete: true })
  })

  it('잘린 목록으로 저장소 범위를 다시 써도 기존 행을 줄이지 않고, 닫힌 것만 뺀다', () => {
    replaceRepoPullRequests(
      db,
      1,
      [
        prRecord('a', 1, { updatedAt: '2026-10-05T00:00:00Z' }),
        prRecord('b', 1, { updatedAt: '2026-10-04T00:00:00Z' }),
        prRecord('c', 1, { updatedAt: '2026-10-03T00:00:00Z' }),
        prRecord('d', 1, { updatedAt: '2026-10-01T00:00:00Z' })
      ],
      { totalCount: 4 }
    )
    // 상세 수집(상한 2): 최근 2개만. c·d 는 창 밖이라 그대로
    replaceRepoPullRequests(
      db,
      1,
      [
        prRecord('a', 1, { updatedAt: '2026-10-06T00:00:00Z' }),
        prRecord('b', 1, { updatedAt: '2026-10-04T00:00:00Z' })
      ],
      { totalCount: 4 }
    )
    expect(listRepoPullRequests(db, 1).items.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(listRepoPullRequests(db, 1)).toMatchObject({ totalCount: 4, complete: true })
    // b 가 닫힘: 캐시의 b(10-04)는 새 창의 최소(10-03)보다 최근인데 없으므로 닫힌 것
    replaceRepoPullRequests(
      db,
      1,
      [
        prRecord('a', 1, { updatedAt: '2026-10-07T00:00:00Z' }),
        prRecord('c', 1, { updatedAt: '2026-10-03T00:00:00Z' })
      ],
      { totalCount: 3 }
    )
    expect(listRepoPullRequests(db, 1).items.map((p) => p.id)).toEqual(['a', 'c', 'd'])
    expect(listRepoPullRequests(db, 1)).toMatchObject({ totalCount: 3, complete: true })
  })
})
