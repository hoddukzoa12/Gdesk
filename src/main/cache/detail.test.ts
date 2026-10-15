import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/connection'
import { replacePullRequests, replaceRepoPullRequests } from './pull-requests'
import { getRepositoryDetail, listTrackedRepoHeads, saveRepositoryDetail } from './repo-detail'
import { getRepository, replaceMyRepositories, setRepositoryAccessStatus } from './repositories'
import { detailRecord, issueRecord, prRecord, repoRecord } from './test-fixtures'
import type { CommitRecord, ReleaseRecord } from './types'

const NOW = Date.UTC(2026, 9, 15, 12)

function commit(i: number, ci: CommitRecord['ciStatus']): CommitRecord {
  return {
    sha: `sha${i}`.padEnd(40, '0'),
    shortSha: `sha${i}`.padEnd(7, '0'),
    message: `commit ${i}`,
    author: { login: 'me', avatarUrl: null, isBot: false },
    authorName: 'Me',
    committedAt: `2026-10-${String(10 - i).padStart(2, '0')}T00:00:00Z`,
    url: `https://github.com/me/repo1/commit/sha${i}`,
    ciStatus: ci
  }
}

function release(tag: string, patch: Partial<ReleaseRecord> = {}): ReleaseRecord {
  return {
    id: `RE_${tag}`,
    tagName: tag,
    name: tag,
    publishedAt: '2026-10-01T00:00:00Z',
    createdAt: '2026-10-01T00:00:00Z',
    isPrerelease: false,
    isDraft: false,
    isLatest: false,
    url: `https://github.com/me/repo1/releases/tag/${tag}`,
    ...patch
  }
}

describe('저장소 상세 캐시', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('상세 수집 전에는 머리글만, 없는 저장소는 null', () => {
    replaceMyRepositories(db, [repoRecord(1, { openPullRequestCount: 4 })])
    const detail = getRepositoryDetail(db, 1, { now: NOW })
    expect(detail?.detailSyncedAt).toBeNull()
    expect(detail?.openPullRequestCount).toBe(4)
    expect(detail?.commits).toEqual([])
    expect(detail?.latestCommitCi).toBe('none')
    expect(detail?.stars.daily).toHaveLength(30)
    expect(getRepositoryDetail(db, 2, { now: NOW })).toBeNull()
  })

  it('저장·읽기: 지표·본문 전체', () => {
    replaceMyRepositories(db, [repoRecord(1)])
    replacePullRequests(db, 'mine', [prRecord('mine-elsewhere', 7, { viewerIsAuthor: true })])
    setRepositoryAccessStatus(db, 1, 'unavailable')
    saveRepositoryDetail(
      db,
      detailRecord(repoRecord(1, { openPullRequestCount: 2, openIssueCount: 1, name: 'renamed' }), {
        openPullRequests: [
          prRecord('p1', 1, { updatedAt: '2026-10-02T00:00:00Z' }),
          prRecord('p2', 1, { viewerIsAuthor: true, updatedAt: '2026-10-01T00:00:00Z' })
        ],
        openIssues: [issueRecord('i1', 1)],
        commits: [commit(0, 'failing'), commit(1, 'passing'), commit(2, 'none')],
        latestRelease: release('v2', { isLatest: true }),
        releaseCount: 3,
        releases: [release('v2', { isLatest: true }), release('v2-rc', { isPrerelease: true })],
        languages: [
          { name: 'TypeScript', color: '#3178c6', bytes: 300 },
          { name: 'CSS', color: null, bytes: 100 }
        ],
        contributors: [{ login: 'a', avatarUrl: null, url: null, contributions: 5 }],
        contributorCount: 42,
        stargazers: [
          { starredAt: '2026-10-15T01:00:00Z', login: 'x' },
          { starredAt: '2026-10-14T01:00:00Z', login: 'y' },
          { starredAt: '2026-09-01T00:00:00Z', login: 'old' }
        ],
        starsSince: '2026-09-14T00:00:00Z'
      }),
      NOW
    )
    const d = getRepositoryDetail(db, 1, { now: NOW })!
    expect(d.repository).toMatchObject({ name: 'renamed', accessStatus: 'available', isMine: true })
    expect(d.detailSyncedAt).toBe(NOW)
    expect(d.openPullRequestCount).toBe(2)
    expect(d.openPullRequests.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(d.myPullRequests.map((p) => p.id)).toEqual(['p2'])
    expect(d.openIssues.map((i) => i.id)).toEqual(['i1'])
    expect(d.commits.map((c) => c.ciStatus)).toEqual(['failing', 'passing', 'none'])
    expect(d.latestCommitCi).toBe('failing')
    expect(d.latestRelease?.tagName).toBe('v2')
    expect(d.releaseCount).toBe(3)
    expect(d.releases.map((r) => [r.tagName, r.isPrerelease])).toEqual([
      ['v2', false],
      ['v2-rc', true]
    ])
    expect(d.languages).toEqual([
      { name: 'TypeScript', color: '#3178c6', bytes: 300, ratio: 0.75 },
      { name: 'CSS', color: null, bytes: 100, ratio: 0.25 }
    ])
    expect(d.contributorCount).toBe(42)
    expect(d.contributors).toHaveLength(1)
    expect(d.stars.total).toBe(2)
    expect(d.stars.daily.at(-1)).toEqual({ date: '2026-10-15', count: 1 })
    expect(d.stars.daily.at(-2)).toEqual({ date: '2026-10-14', count: 1 })

    // 다시 저장하면 목록을 통째로 바꾼다
    saveRepositoryDetail(db, detailRecord(repoRecord(1), { commits: [commit(5, 'passing')] }), NOW)
    const d2 = getRepositoryDetail(db, 1, { now: NOW })!
    expect(d2.commits.map((c) => c.sha.slice(0, 4))).toEqual(['sha5'])
    expect(d2.openPullRequests).toEqual([])
    expect(d2.stars.total).toBe(0)
    expect(d2.latestRelease).toBeNull()
  })

  it('상세 추적 저장소의 머리 정보', () => {
    saveRepositoryDetail(db, detailRecord(repoRecord(1), { commits: [commit(0, 'failing')] }), NOW)
    upsertOnly(db)
    const heads = listTrackedRepoHeads(db, [1, 2, 3])
    expect(heads.map((h) => [h.repoId, h.latestCommit?.ciStatus ?? null])).toEqual([
      [1, 'failing'],
      [2, null]
    ])
    expect(getRepository(db, 2)).not.toBeNull()
  })
  it('상한이 작은 상세 수집이 목록 수집이 저장한 열린 PR 을 줄이지 않는다', () => {
    replaceMyRepositories(db, [repoRecord(1, { openPullRequestCount: 3 })])
    replaceRepoPullRequests(
      db,
      1,
      [
        prRecord('p1', 1, { updatedAt: '2026-10-03T00:00:00Z' }),
        prRecord('p2', 1, { updatedAt: '2026-10-02T00:00:00Z' }),
        prRecord('p3', 1, { updatedAt: '2026-10-01T00:00:00Z' })
      ],
      { totalCount: 3 }
    )
    saveRepositoryDetail(
      db,
      detailRecord(repoRecord(1, { openPullRequestCount: 3 }), {
        openPullRequests: [prRecord('p1', 1, { updatedAt: '2026-10-04T00:00:00Z' })]
      }),
      NOW
    )
    const d = getRepositoryDetail(db, 1, { now: NOW })!
    expect(d.openPullRequests.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(d.openPullRequestsComplete).toBe(true)
    expect(d.openIssuesComplete).toBe(true)
  })

  it('상세 목록이 잘렸으면 완전하지 않다고 알린다', () => {
    saveRepositoryDetail(
      db,
      detailRecord(repoRecord(1, { openPullRequestCount: 40, openIssueCount: 9 }), {
        openPullRequests: [prRecord('p1', 1)],
        openIssues: [issueRecord('i1', 1)]
      }),
      NOW
    )
    const d = getRepositoryDetail(db, 1, { now: NOW })!
    expect(d.openPullRequestCount).toBe(40)
    expect(d.openPullRequestsComplete).toBe(false)
    expect(d.openIssuesComplete).toBe(false)
  })
})

function upsertOnly(db: DatabaseSync): void {
  replaceMyRepositories(db, [repoRecord(1), repoRecord(2)])
}
