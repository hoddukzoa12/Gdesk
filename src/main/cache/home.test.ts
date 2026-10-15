import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/connection'
import { getHomeSummary, getSidebarCounts, listUnansweredContributions } from './home'
import { replaceRepoIssues } from './issues'
import { replaceNotifications } from './notifications'
import { replacePullRequests, replaceRepoPullRequests } from './pull-requests'
import { saveRepositoryDetail } from './repo-detail'
import { replaceMyRepositories, upsertRepositories } from './repositories'
import {
  detailRecord,
  issueRecord,
  notificationRecord,
  prRecord,
  repoRecord
} from './test-fixtures'

const NOW = Date.UTC(2026, 9, 15, 12)

describe('Home 요약', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
    replaceMyRepositories(db, [repoRecord(1), repoRecord(2)])
    upsertRepositories(db, [repoRecord(9, { owner: 'other' })])
  })
  afterEach(() => db.close())

  it('응답 없는 새 기여: 내 저장소의 외부 작성·무응답·봇 아님', () => {
    replaceRepoPullRequests(db, 1, [
      prRecord('ok-pr', 1, { updatedAt: '2026-10-05T00:00:00Z' }),
      prRecord('answered', 1, { hasWriteHolderResponse: true }),
      prRecord('member', 1, { authorAssociation: 'MEMBER' }),
      prRecord('bot', 1, { author: { login: 'dependabot', avatarUrl: null, isBot: true } })
    ])
    replaceRepoIssues(db, 2, [issueRecord('ok-issue', 2, { updatedAt: '2026-10-04T00:00:00Z' })])
    // 내 집합 밖 저장소는 대상이 아니다
    replaceRepoIssues(db, 9, [issueRecord('outside', 9)])

    const list = listUnansweredContributions(db)
    expect(list.count).toBe(2)
    expect(list.items.map((c) => [c.kind, c.item.id])).toEqual([
      ['pull_request', 'ok-pr'],
      ['issue', 'ok-issue']
    ])
    const withBots = listUnansweredContributions(db, { excludeBots: false })
    expect(withBots.items.map((c) => c.item.id)).toContain('bot')
    expect(listUnansweredContributions(db, { limit: 1 })).toMatchObject({ count: 2 })
    expect(listUnansweredContributions(db, { limit: 1 }).items).toHaveLength(1)
  })

  it('다섯 카드와 사이드바 수치', () => {
    replacePullRequests(db, 'review_requested', [prRecord('rr', 9)])
    replacePullRequests(db, 'mine', [
      prRecord('myfail', 9, { viewerIsAuthor: true, ciStatus: 'failing' }),
      prRecord('mypass', 9, { viewerIsAuthor: true, ciStatus: 'passing' })
    ])
    replaceNotifications(db, [
      notificationRecord('n1'),
      notificationRecord('n2', { state: 'read' })
    ])
    saveRepositoryDetail(
      db,
      detailRecord(repoRecord(1), {
        commits: [
          {
            sha: 'f'.repeat(40),
            shortSha: 'fffffff',
            message: 'broken',
            author: null,
            authorName: null,
            committedAt: null,
            url: 'https://github.com/me/repo1/commit/fff',
            ciStatus: 'failing'
          }
        ],
        stargazers: [
          { starredAt: '2026-10-15T00:00:00Z', login: 'a' },
          { starredAt: '2026-10-09T00:00:00Z', login: 'b' },
          { starredAt: '2026-10-08T23:59:59Z', login: 'c' }
        ]
      }),
      NOW
    )
    saveRepositoryDetail(db, detailRecord(repoRecord(2)), NOW)
    // 상세 저장이 repo:1 범위를 바꾸므로 그 뒤에 넣는다
    replaceRepoPullRequests(db, 1, [prRecord('in', 1)])

    const home = getHomeSummary(db, [1, 2], { now: NOW })
    expect(home.reviewRequests).toMatchObject({ count: 1 })
    expect(home.reviewRequests.items.map((p) => p.id)).toEqual(['rr'])
    expect(home.unreadNotifications.count).toBe(1)
    expect(home.unreadNotifications.items.map((n) => n.threadId)).toEqual(['n1'])
    expect(home.failedCi.repos.map((r) => r.repoId)).toEqual([1])
    expect(home.failedCi.pullRequests.map((p) => p.id)).toEqual(['myfail'])
    expect(home.unansweredContributions.items.map((c) => c.item.id)).toEqual(['in'])
    expect(home.starChanges).toEqual({
      windowDays: 7,
      items: [
        { repoId: 1, repoFullName: 'me/repo1', gained: 2, truncated: false },
        { repoId: 2, repoFullName: 'me/repo2', gained: 0, truncated: false }
      ]
    })
    expect(
      getHomeSummary(db, [1], { now: NOW, starWindowDays: 1 }).starChanges.items[0]?.gained
    ).toBe(1)
    // 추적하지 않으면 (a)·스타 변화에 없다
    const untracked = getHomeSummary(db, [], { now: NOW })
    expect(untracked.failedCi.repos).toEqual([])
    expect(untracked.starChanges.items).toEqual([])

    expect(getSidebarCounts(db)).toEqual({
      unreadNotifications: 1,
      incomingPullRequests: 1,
      reviewRequests: 1
    })
  })
})
