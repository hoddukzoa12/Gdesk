import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearFetchedData, resetFetchedDataCleaners } from '../db/cleanup'
import { openDatabase } from '../db/connection'
import { listPins, pinRepo } from '../pins/pins.service'
import { CACHE_TABLES, clearCache, initCache } from './cleaner'
import { replaceContributions, replaceRecentCommits } from './home-activity'
import { listOrgRestrictions, recordOrgRestrictions } from './org-restrictions'
import { replaceRepoIssues } from './issues'
import { removeNotification, replaceNotifications } from './notifications'
import { replacePullRequests, replaceRepoPullRequests } from './pull-requests'
import { saveRepositoryDetail } from './repo-detail'
import { replaceMyRepositories, replaceStarredRepositories } from './repositories'
import { searchLocal } from './search'
import { getSyncState, listSyncStates, updateSyncState } from './sync-state'
import {
  detailRecord,
  issueRecord,
  notificationRecord,
  prRecord,
  repoRecord
} from './test-fixtures'

function rowCount(db: DatabaseSync, table: string): number {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n)
}

function fillEverything(db: DatabaseSync): void {
  // 상세 저장은 repo:1 범위를 통째로 바꾸므로 먼저 한다
  saveRepositoryDetail(
    db,
    detailRecord(repoRecord(1), {
      commits: [
        {
          sha: 'a'.repeat(40),
          shortSha: 'aaaaaaa',
          message: 'm',
          author: null,
          authorName: null,
          committedAt: null,
          url: 'u',
          ciStatus: 'passing'
        }
      ],
      releases: [
        {
          id: 'r',
          tagName: 'v1',
          name: null,
          publishedAt: null,
          createdAt: '2026-10-01T00:00:00Z',
          isPrerelease: false,
          isDraft: false,
          isLatest: true,
          url: 'u'
        }
      ],
      languages: [{ name: 'Go', color: null, bytes: 1 }],
      contributors: [{ login: 'c', avatarUrl: null, url: null, contributions: 1 }],
      stargazers: [{ starredAt: '2026-10-01T00:00:00Z', login: 's' }]
    })
  )
  replaceMyRepositories(db, [repoRecord(1)])
  replaceStarredRepositories(db, [{ repository: repoRecord(2), starredAt: '2026-10-01T00:00:00Z' }])
  replaceRepoPullRequests(db, 1, [prRecord('p', 1)])
  replacePullRequests(db, 'mine', [prRecord('m', 2, { viewerIsAuthor: true })])
  replaceRepoIssues(db, 1, [issueRecord('i', 1)])
  replaceNotifications(db, [notificationRecord('n'), notificationRecord('done')])
  removeNotification(db, 'done')
  updateSyncState(db, 'notifications', { lastSyncedAt: 1, etag: 'W/"x"' })
  recordOrgRestrictions(db, [{ reason: 'saml_enforcement', orgLogin: 'acme', message: 'SAML' }])
  replaceContributions(db, {
    totalCommitContributions: 3,
    days: [{ date: '2026-10-15', count: 3, level: 'FIRST_QUARTILE' }]
  })
  replaceRecentCommits(db, [
    {
      repoFullName: 'me/repo1',
      sha: 'b'.repeat(40),
      message: 'm',
      authorAvatarUrl: null,
      authorDate: '2026-10-15T00:00:00Z',
      url: 'u'
    }
  ])
}

describe('캐시 삭제 등록', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => {
    resetFetchedDataCleaners()
    db.close()
  })

  it('모든 cache_ 테이블이 CACHE_TABLES 에 있다', () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'cache\\_%' ESCAPE '\\'"
      )
      .all()
      .map((r) => String(r.name))
      .sort()
    expect([...CACHE_TABLES].sort()).toEqual(tables)
  })

  it('initCache 로 등록하면 clearFetchedData 가 캐시를 비우고 고정은 남긴다', () => {
    fillEverything(db)
    pinRepo(db, 1)
    for (const t of CACHE_TABLES) expect(rowCount(db, t), t).toBeGreaterThan(0)
    initCache()
    initCache() // 두 번 불러도 한 번만 등록
    clearFetchedData(db)
    for (const t of CACHE_TABLES) expect(rowCount(db, t), t).toBe(0)
    expect(listPins(db)).toHaveLength(1)
  })

  it('clearCache 를 직접 불러도 비운다', () => {
    fillEverything(db)
    clearCache(db)
    for (const t of CACHE_TABLES) expect(rowCount(db, t), t).toBe(0)
  })
})

describe('조직 접근 제한·동기화 상태', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('조직별로 한 번씩 기록하고 최신 값으로 갱신한다', () => {
    recordOrgRestrictions(
      db,
      [
        { reason: 'oauth_app_restriction', orgLogin: 'acme', message: 'm1' },
        { reason: 'saml_enforcement', orgLogin: 'acme', message: 'm2' },
        { reason: 'saml_enforcement', message: 'unknown org' }
      ],
      100
    )
    expect(listOrgRestrictions(db)).toEqual([
      { orgLogin: null, reason: 'saml_enforcement', message: 'unknown org', recordedAt: 100 },
      { orgLogin: 'acme', reason: 'saml_enforcement', message: 'm2', recordedAt: 100 }
    ])
  })

  it('동기화 상태는 일부 필드만 바꾼다', () => {
    expect(getSyncState(db, 'notifications')).toEqual({
      scope: 'notifications',
      lastSyncedAt: null,
      etag: null,
      lastModified: null,
      pollInterval: null
    })
    updateSyncState(db, 'notifications', { etag: 'e1', pollInterval: 60 })
    updateSyncState(db, 'notifications', { lastSyncedAt: 5 })
    expect(getSyncState(db, 'notifications')).toEqual({
      scope: 'notifications',
      lastSyncedAt: 5,
      etag: 'e1',
      lastModified: null,
      pollInterval: 60
    })
    updateSyncState(db, 'notifications', { etag: null })
    expect(getSyncState(db, 'notifications').etag).toBeNull()
    expect(listSyncStates(db).map((s) => s.scope)).toEqual(['notifications'])
  })
})

describe('searchLocal', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
    fillEverything(db)
    replaceRepoPullRequests(db, 1, [prRecord('p', 1, { title: 'Fix the parser', number: 42 })])
    replaceRepoIssues(db, 1, [issueRecord('i', 1, { title: 'Parser crashes', number: 7 })])
  })
  afterEach(() => db.close())

  it.each([
    ['parser', [], ['p'], ['i']],
    ['repo1', ['me/repo1'], ['p'], ['i']],
    ['#42', [], ['p'], []],
    ['#7', [], [], ['i']],
    ['100%', [], [], []],
    ['  ', [], [], []]
  ] as const)('%s', (text, repos, prs, issues) => {
    const r = searchLocal(db, text)
    expect(r.repositories.map((x) => x.fullName)).toEqual(repos)
    expect(r.pullRequests.map((x) => x.id)).toEqual(prs)
    expect(r.issues.map((x) => x.id)).toEqual(issues)
  })
})
