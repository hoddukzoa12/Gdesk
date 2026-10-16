import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/connection'
import { replaceRepoIssues, replaceIssues } from '../cache/issues'
import { replaceNotifications } from '../cache/notifications'
import { recordOrgRestrictions } from '../cache/org-restrictions'
import { replacePullRequests, replaceRepoPullRequests } from '../cache/pull-requests'
import { saveRepositoryDetail } from '../cache/repo-detail'
import { saveIssueDetail } from '../cache/issue-details'
import {
  markRepositoryUnavailable,
  replaceMyRepositories,
  replaceStarredRepositories,
  upsertRepositories
} from '../cache/repositories'
import {
  detailRecord,
  issueDetailRecord,
  issueRecord,
  notificationRecord,
  prRecord,
  repoRecord
} from '../cache/test-fixtures'
import { replaceContributions, replaceRecentCommits } from '../cache/home-activity'
import { updateSyncState } from '../cache/sync-state'
import { SYNC_SCOPES } from '../github/collectors/refresh'
import { pinRepo } from '../pins/pins.service'
import {
  queryHome,
  queryInbox,
  queryIssueDetail,
  queryIssueRepoOptions,
  queryIssues,
  queryOrgRestrictions,
  queryPulls,
  queryRepoDetail,
  queryRepositories,
  queryReviews,
  querySidebar,
  queryStarred
} from './queries'
import type { QueryContext } from './queries'

const NOW = Date.UTC(2026, 9, 15, 12)

describe('화면 조회', () => {
  let db: DatabaseSync
  let ctx: QueryContext
  let tracked: number[]
  let inboxAvailable: boolean

  beforeEach(() => {
    db = openDatabase(':memory:')
    tracked = []
    inboxAvailable = true
    ctx = {
      trackedRepoIds: () => tracked,
      inboxAvailable: () => inboxAvailable,
      utcOffsetMinutes: () => 540,
      now: () => NOW,
      viewerLogin: () => 'me'
    }
    replaceMyRepositories(db, [
      repoRecord(1, { pushedAt: '2026-10-10T00:00:00Z', stargazerCount: 11 }),
      repoRecord(2, { pushedAt: '2026-10-12T00:00:00Z', owner: 'acme', ownerType: 'Organization' }),
      repoRecord(3, { pushedAt: '2026-10-11T00:00:00Z', fork: true }),
      repoRecord(4, { pushedAt: '2026-10-09T00:00:00Z', archived: true })
    ])
  })
  afterEach(() => db.close())

  it('query:home 은 상세 추적 ID 와 시간대를 넘긴다', () => {
    saveRepositoryDetail(
      db,
      detailRecord(repoRecord(1), {
        stargazers: [{ starredAt: '2026-10-15T00:00:00Z', login: 'a' }]
      }),
      NOW
    )
    tracked = [1]
    const home = queryHome(db, ctx)
    expect(home.starChanges.items).toEqual([
      { repoId: 1, repoFullName: 'me/repo1', gained: 1, truncated: false }
    ])
    tracked = []
    expect(queryHome(db, ctx).starChanges.items).toEqual([])
  })

  it('query:home: 받기 전에는 수치가 null 이고 활동 영역은 비어 있다', () => {
    const home = queryHome(db, ctx)
    expect(home.stats).toEqual({
      commits: null,
      repositories: null,
      openPullRequests: null,
      streak: null
    })
    expect(home.contributions).toBeNull()
    expect(home.recentCommits).toEqual({
      items: [],
      fetched: false,
      viewAllUrl: 'https://github.com/search?q=author:me&type=commits&s=author-date&o=desc'
    })
    expect(home.myPullRequests).toEqual({ totalCount: 0, complete: true, items: [] })
    expect(home.pinnedRepos).toEqual([])
    // 기존 카드 다섯 종류는 그대로 온다
    expect(Object.keys(home)).toEqual(
      expect.arrayContaining([
        'reviewRequests',
        'unreadNotifications',
        'failedCi',
        'unansweredContributions',
        'starChanges'
      ])
    )
    expect(queryHome(db, { ...ctx, viewerLogin: () => null }).recentCommits.viewAllUrl).toBeNull()
  })

  it('query:home 수치: 저장소 수는 포크·보관 제외, PR 은 GitHub 전체 수, 커밋·연속 기여는 달력', () => {
    updateSyncState(db, SYNC_SCOPES.repositories, { lastSyncedAt: NOW })
    replacePullRequests(
      db,
      'mine',
      [prRecord('m1', 1, { viewerIsAuthor: true }), prRecord('m2', 2, { viewerIsAuthor: true })],
      { totalCount: 12 }
    )
    updateSyncState(db, SYNC_SCOPES.myPullRequests, { lastSyncedAt: NOW })
    replaceContributions(db, {
      totalCommitContributions: 345,
      days: [
        { date: '2026-10-12', count: 0, level: 'NONE' },
        { date: '2026-10-13', count: 2, level: 'FIRST_QUARTILE' },
        { date: '2026-10-14', count: 5, level: 'SECOND_QUARTILE' },
        { date: '2026-10-15', count: 0, level: 'NONE' }
      ]
    })
    const home = queryHome(db, ctx)
    // 저장소 1~4 중 3 은 포크, 4 는 보관
    expect(home.stats).toEqual({ commits: 345, repositories: 2, openPullRequests: 12, streak: 2 })
    expect(home.contributions?.days).toEqual([
      { date: '2026-10-12', count: 0, level: 'NONE', weekday: 1 },
      { date: '2026-10-13', count: 2, level: 'FIRST_QUARTILE', weekday: 2 },
      { date: '2026-10-14', count: 5, level: 'SECOND_QUARTILE', weekday: 3 },
      { date: '2026-10-15', count: 0, level: 'NONE', weekday: 4 }
    ])
  })

  it('query:home 내 PR: 최근 갱신 5개, 전체 수, 표시 상태, 코멘트 수', () => {
    const prs = [
      prRecord('d', 1, {
        state: 'draft',
        reviewStatus: 'approved',
        updatedAt: '2026-10-09T00:00:00Z'
      }),
      prRecord('c', 1, { reviewStatus: 'changes_requested', updatedAt: '2026-10-08T00:00:00Z' }),
      prRecord('a', 1, { reviewStatus: 'approved', updatedAt: '2026-10-07T00:00:00Z' }),
      prRecord('r', 1, { reviewStatus: 'review_required', updatedAt: '2026-10-06T00:00:00Z' }),
      prRecord('o', 1, { commentCount: 4, updatedAt: '2026-10-05T00:00:00Z' }),
      prRecord('old', 1, { updatedAt: '2026-10-01T00:00:00Z' })
    ].map((p) => ({ ...p, viewerIsAuthor: true }))
    replacePullRequests(db, 'mine', prs, { totalCount: 30 })
    const mine = queryHome(db, ctx).myPullRequests
    expect(mine.totalCount).toBe(30)
    expect(mine.complete).toBe(false)
    expect(mine.items.map((p) => [p.id, p.displayStatus])).toEqual([
      ['d', 'draft'],
      ['c', 'changes_requested'],
      ['a', 'approved'],
      ['r', 'review_required'],
      ['o', 'open']
    ])
    expect(mine.items[4]?.commentCount).toBe(4)
  })

  it('query:home 고정 저장소 카드: 고정 순서, 최대 4개, 캐시에 없는 고정도 자리를 지킨다', () => {
    upsertRepositories(db, [
      repoRecord(30, {
        description: 'thirty',
        stargazerCount: 7,
        forkCount: 2,
        ownerAvatarUrl: 'https://avatars/me',
        primaryLanguage: 'Rust',
        primaryLanguageColor: '#dea584'
      })
    ])
    markRepositoryUnavailable(db, 2)
    for (const id of [30, 99, 2, 1, 4]) pinRepo(db, id)
    const pinned = queryHome(db, ctx).pinnedRepos
    expect(pinned.map((p) => p.repoId)).toEqual([30, 99, 2, 1])
    expect(pinned[0]).toEqual({
      repoId: 30,
      cached: true,
      owner: 'me',
      name: 'repo30',
      fullName: 'me/repo30',
      url: 'https://github.com/me/repo30',
      description: 'thirty',
      primaryLanguage: 'Rust',
      primaryLanguageColor: '#dea584',
      stargazerCount: 7,
      forkCount: 2,
      ownerAvatarUrl: 'https://avatars/me',
      accessStatus: 'available'
    })
    expect(pinned[1]).toEqual({
      repoId: 99,
      cached: false,
      owner: null,
      name: null,
      fullName: null,
      url: null,
      description: null,
      primaryLanguage: null,
      primaryLanguageColor: null,
      stargazerCount: null,
      forkCount: null,
      ownerAvatarUrl: null,
      accessStatus: 'unavailable'
    })
    expect(pinned[2]?.accessStatus).toBe('unavailable')
  })

  it('query:home 최근 커밋: 저장된 순서와 "모두 보기" 주소', () => {
    replaceRecentCommits(db, [
      {
        repoFullName: 'me/app',
        sha: 'a1',
        message: 'fix',
        authorAvatarUrl: null,
        authorDate: '2026-10-15T00:00:00Z',
        url: 'https://github.com/me/app/commit/a1'
      },
      {
        repoFullName: 'x/lib',
        sha: 'b2',
        message: 'feat',
        authorAvatarUrl: 'https://avatars/me',
        authorDate: '2026-10-14T00:00:00Z',
        url: 'https://github.com/x/lib/commit/b2'
      }
    ])
    updateSyncState(db, SYNC_SCOPES.recentCommits, { lastSyncedAt: NOW })
    const recent = queryHome(db, ctx).recentCommits
    expect(recent.fetched).toBe(true)
    expect(recent.items.map((c) => c.sha)).toEqual(['a1', 'b2'])
    expect(recent.items[1]).toEqual({
      repoFullName: 'x/lib',
      sha: 'b2',
      message: 'feat',
      authorAvatarUrl: 'https://avatars/me',
      authorDate: '2026-10-14T00:00:00Z',
      url: 'https://github.com/x/lib/commit/b2'
    })
  })

  it('query:inbox 는 거르기·완전성·inboxAvailable 을 준다', () => {
    replaceNotifications(db, [
      notificationRecord('n1', { repoId: 1, reason: 'mention' }),
      notificationRecord('n2', { repoId: 2, reason: 'assign', state: 'read' })
    ])
    expect(queryInbox(db, {}, ctx)).toMatchObject({ complete: true, inboxAvailable: true })
    expect(queryInbox(db, {}, ctx).items.map((n) => n.threadId)).toEqual(['n1', 'n2'])
    expect(queryInbox(db, { unreadOnly: true }, ctx).items.map((n) => n.threadId)).toEqual(['n1'])
    expect(queryInbox(db, { repoId: 2 }, ctx).items.map((n) => n.threadId)).toEqual(['n2'])
    expect(queryInbox(db, { reason: 'mention' }, ctx).items.map((n) => n.threadId)).toEqual(['n1'])
    expect(queryInbox(db, undefined, ctx).items).toHaveLength(2)
    inboxAvailable = false
    expect(queryInbox(db, {}, ctx).inboxAvailable).toBe(false)
    expect(() => queryInbox(db, { repoId: 0 }, ctx)).toThrow()
  })

  it('query:pulls · query:reviews · query:issues 는 탭별 목록', () => {
    replaceRepoPullRequests(db, 1, [prRecord('in1', 1)])
    replacePullRequests(db, 'mine', [prRecord('my1', 9, { viewerIsAuthor: true })])
    replacePullRequests(db, 'review_requested', [prRecord('rr1', 9)], { totalCount: 3 })
    replaceRepoIssues(db, 1, [issueRecord('iin', 1)])
    replaceIssues(db, 'assigned', [issueRecord('ias', 9)])
    replaceIssues(db, 'mine', [issueRecord('imy', 9, { viewerIsAuthor: true })])

    expect(queryPulls(db, { tab: 'incoming' }).items.map((p) => p.id)).toEqual(['in1'])
    expect(queryPulls(db, { tab: 'mine' }).items.map((p) => p.id)).toEqual(['my1'])
    expect(queryReviews(db)).toMatchObject({ totalCount: 3, complete: false })
    expect(queryIssues(db, { tab: 'incoming' }).page.items.map((i) => i.id)).toEqual(['iin'])
    expect(queryIssues(db, { tab: 'assigned' }).page.items.map((i) => i.id)).toEqual(['ias'])
    expect(queryIssues(db, { tab: 'mine' }).page.items.map((i) => i.id)).toEqual(['imy'])
    expect(queryIssues(db, { tab: 'mentioned' }).page.items).toEqual([])
    expect(() => queryPulls(db, { tab: 'nope' as never })).toThrow()
    expect(() => queryIssues(db, { tab: 'nope' as never })).toThrow()
  })

  it('query:issues 는 요청한 탭 목록과 네 탭의 전체 수를 함께 준다', () => {
    replaceRepoIssues(db, 1, [issueRecord('iin', 1)])
    replaceIssues(db, 'assigned', [issueRecord('ias', 9)], { totalCount: 4 })
    replaceIssues(db, 'mentioned', [issueRecord('imen', 9), issueRecord('imen2', 8)], {
      totalCount: 60
    })
    const result = queryIssues(db, { tab: 'mentioned' })
    expect(result.page).toMatchObject({ totalCount: 60, complete: false })
    expect(result.page.items.map((i) => i.id).sort()).toEqual(['imen', 'imen2'])
    expect(result.counts).toEqual({ incoming: 1, assigned: 4, mentioned: 60, mine: 0 })
    expect(queryIssues(db, { tab: 'incoming' }).counts).toEqual(result.counts)
  })

  it('query:issueDetail 은 받은 상세 또는 null, 잘못된 키는 거절', () => {
    expect(queryIssueDetail(db, { repoId: 1, number: 5 })).toBeNull()
    saveIssueDetail(db, issueDetailRecord(1, 5, { locked: true, viewerPermission: 'WRITE' }), NOW)
    expect(queryIssueDetail(db, { repoId: 1, number: 5 })).toMatchObject({
      number: 5,
      viewerCanComment: true,
      fetchedAt: NOW
    })
    expect(() => queryIssueDetail(db, { repoId: 0, number: 5 })).toThrow()
    expect(() => queryIssueDetail(db, { repoId: 1, number: 0 })).toThrow()
    expect(() => queryIssueDetail(db, { repoId: 1, number: 1.5 })).toThrow()
    expect(() => queryIssueDetail(db, undefined)).toThrow()
  })

  it('query:issueRepoOptions 는 포크·보관을 뺀 내 저장소, 최근 푸시 순', () => {
    upsertRepositories(db, [
      repoRecord(2, {
        owner: 'acme',
        pushedAt: '2026-10-12T00:00:00Z',
        hasIssuesEnabled: false
      })
    ])
    expect(
      queryIssueRepoOptions(db).map((r) => [r.repoId, r.fullName, r.hasIssuesEnabled])
    ).toEqual([
      [2, 'acme/repo2', false],
      [1, 'me/repo1', true]
    ])
  })

  it('query:starred 는 스타한 시각 순, 검색', () => {
    replaceStarredRepositories(db, [
      {
        repository: repoRecord(20, { owner: 'x', name: 'alpha' }),
        starredAt: '2026-01-01T00:00:00Z'
      },
      {
        repository: repoRecord(21, { owner: 'x', name: 'beta' }),
        starredAt: '2026-05-01T00:00:00Z'
      }
    ])
    expect(queryStarred(db, {}).map((r) => r.id)).toEqual([21, 20])
    expect(queryStarred(db, { search: 'alp' }).map((r) => r.id)).toEqual([20])
    expect(queryStarred(db, undefined).map((r) => r.id)).toEqual([21, 20])
  })

  it('query:repositories 는 거르기·정렬과 소유자 목록', () => {
    const base = queryRepositories(db, {})
    expect(base.items.map((r) => r.id)).toEqual([2, 1])
    expect(base.owners).toEqual([
      { login: 'acme', type: 'Organization', count: 1 },
      { login: 'me', type: 'User', count: 3 }
    ])
    expect(
      queryRepositories(db, {
        includeForks: true,
        includeArchived: true,
        sort: 'pushed'
      }).items.map((r) => r.id)
    ).toEqual([2, 3, 1, 4])
    expect(queryRepositories(db, { owner: 'acme' }).items.map((r) => r.id)).toEqual([2])
    expect(queryRepositories(db, { search: 'repo1' }).items.map((r) => r.id)).toEqual([1])
    expect(() => queryRepositories(db, { sort: 'bogus' as never })).toThrow()
  })

  it('query:repoDetail 은 상세·접근 상태·고정 여부, 모르면 null', () => {
    pinRepo(db, 1)
    saveRepositoryDetail(db, detailRecord(repoRecord(1)), NOW)
    const one = queryRepoDetail(db, { repoId: 1 }, ctx)
    expect(one).toMatchObject({ accessStatus: 'available', pinned: true })
    expect(one?.detail.repository.id).toBe(1)
    expect(one?.detail.detailSyncedAt).toBe(NOW)

    expect(queryRepoDetail(db, { repoId: 2 }, ctx)).toMatchObject({ pinned: false })
    markRepositoryUnavailable(db, 2, NOW)
    expect(queryRepoDetail(db, { repoId: 2 }, ctx)?.accessStatus).toBe('unavailable')
    expect(queryRepoDetail(db, { repoId: 999 }, ctx)).toBeNull()
    expect(() => queryRepoDetail(db, { repoId: -3 }, ctx)).toThrow()
  })

  it('query:sidebar 는 수치·고정 목록(접근 불가·캐시에 없는 저장소 포함)·최근 푸시 저장소', () => {
    replaceNotifications(db, [
      notificationRecord('n1'),
      notificationRecord('n2', { state: 'read' })
    ])
    replaceRepoPullRequests(db, 1, [prRecord('p1', 1), prRecord('p2', 1)])
    replacePullRequests(db, 'review_requested', [prRecord('rr', 9)])
    upsertRepositories(db, [repoRecord(1, { stargazerCount: 11, openPullRequestCount: 2 })])

    pinRepo(db, 2) // 있는 저장소
    pinRepo(db, 50) // 캐시에 없는 저장소
    pinRepo(db, 1)
    pinRepo(db, 60) // 사라진 저장소(자리 행)
    markRepositoryUnavailable(db, 60, NOW)

    const sidebar = querySidebar(db)
    expect(sidebar.counts).toEqual({
      unreadNotifications: 1,
      incomingPullRequests: 2,
      reviewRequests: 1
    })
    expect(sidebar.pinned).toEqual([
      {
        repoId: 2,
        position: 0,
        cached: true,
        owner: 'acme',
        name: 'repo2',
        fullName: 'acme/repo2',
        stargazerCount: 10,
        openPullRequestCount: 0,
        accessStatus: 'available'
      },
      {
        repoId: 50,
        position: 1,
        cached: false,
        owner: null,
        name: null,
        fullName: null,
        stargazerCount: null,
        openPullRequestCount: null,
        accessStatus: 'unavailable'
      },
      {
        repoId: 1,
        position: 2,
        cached: true,
        owner: 'me',
        name: 'repo1',
        fullName: 'me/repo1',
        stargazerCount: 11,
        openPullRequestCount: 2,
        accessStatus: 'available'
      },
      {
        repoId: 60,
        position: 3,
        cached: true,
        owner: null,
        name: null,
        fullName: null,
        stargazerCount: null,
        openPullRequestCount: null,
        accessStatus: 'unavailable'
      }
    ])
    // 포크·보관 제외, 최근 푸시 순
    expect(sidebar.yourRepositories.map((r) => r.repoId)).toEqual([2, 1])
    expect(sidebar.yourRepositories[1]).toMatchObject({ fullName: 'me/repo1', stargazerCount: 11 })
  })

  it('query:sidebar 의 내 저장소 개수는 기본 8, 바꿀 수 있다', () => {
    replaceMyRepositories(
      db,
      Array.from({ length: 12 }, (_, i) =>
        repoRecord(100 + i, { pushedAt: `2026-10-${String(10 + i).padStart(2, '0')}T00:00:00Z` })
      )
    )
    expect(querySidebar(db).yourRepositories).toHaveLength(8)
    expect(querySidebar(db).yourRepositories[0]?.repoId).toBe(111)
    expect(querySidebar(db, { yourRepositoriesLimit: 3 }).yourRepositories).toHaveLength(3)
  })

  it('query:orgRestrictions', () => {
    recordOrgRestrictions(db, [{ reason: 'saml_enforcement', orgLogin: 'acme', message: 'm' }], NOW)
    expect(queryOrgRestrictions(db)).toEqual([
      { orgLogin: 'acme', reason: 'saml_enforcement', message: 'm', recordedAt: NOW }
    ])
  })
})
