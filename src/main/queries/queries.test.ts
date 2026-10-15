import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/connection'
import { replaceRepoIssues, replaceIssues } from '../cache/issues'
import { replaceNotifications } from '../cache/notifications'
import { recordOrgRestrictions } from '../cache/org-restrictions'
import { replacePullRequests, replaceRepoPullRequests } from '../cache/pull-requests'
import { saveRepositoryDetail } from '../cache/repo-detail'
import {
  markRepositoryUnavailable,
  replaceMyRepositories,
  replaceStarredRepositories,
  upsertRepositories
} from '../cache/repositories'
import {
  detailRecord,
  issueRecord,
  notificationRecord,
  prRecord,
  repoRecord
} from '../cache/test-fixtures'
import { pinRepo } from '../pins/pins.service'
import {
  queryHome,
  queryInbox,
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
      now: () => NOW
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
    expect(queryIssues(db, { tab: 'incoming' }).items.map((i) => i.id)).toEqual(['iin'])
    expect(queryIssues(db, { tab: 'assigned' }).items.map((i) => i.id)).toEqual(['ias'])
    expect(queryIssues(db, { tab: 'mine' }).items.map((i) => i.id)).toEqual(['imy'])
    expect(() => queryPulls(db, { tab: 'nope' as never })).toThrow()
    expect(() => queryIssues(db, { tab: 'nope' as never })).toThrow()
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
