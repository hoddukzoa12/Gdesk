import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearCache } from '../../cache/cleaner'
import { getContributions, listRecentCommits } from '../../cache/home-activity'
import { getSyncState } from '../../cache/sync-state'
import { clearFetchedData, currentDataGuard, registerFetchedDataCleaner } from '../../db/cleanup'
import { openDatabase } from '../../db/connection'
import { StaleRefreshError } from './common'
import { collectContributions, collectRecentCommits } from './home-activity'
import { OPERATIONS, REST_ENDPOINTS } from './queries'
import { SYNC_SCOPES, refreshContributions, refreshRecentCommits } from './refresh'
import { fakeGitHub, json } from './test-server'

const NOW = Date.UTC(2026, 9, 16, 12)

function day(date: string, contributionCount: number, contributionLevel = 'FIRST_QUARTILE') {
  return { date, contributionCount, contributionLevel }
}

function contributionsResponse() {
  return {
    data: {
      viewer: {
        login: 'me',
        contributionsCollection: {
          totalCommitContributions: 412,
          contributionCalendar: {
            totalContributions: 999,
            weeks: [
              {
                contributionDays: [
                  day('2026-10-11', 0, 'NONE'),
                  day('2026-10-12', 3, 'SECOND_QUARTILE'),
                  null
                ]
              },
              null,
              {
                contributionDays: [
                  day('2026-10-13', 9, 'FOURTH_QUARTILE'),
                  day('2026-10-14', 1, 'WEIRD_LEVEL'),
                  { date: null, contributionCount: 5 },
                  day('2026-10-15', 2, 'THIRD_QUARTILE'),
                  day('2026-10-16', 0, 'NONE')
                ]
              }
            ]
          }
        }
      }
    }
  }
}

function commitItem(sha: string, patch: Record<string, unknown> = {}) {
  return {
    sha,
    html_url: `https://github.com/me/app/commit/${sha}`,
    commit: {
      message: `fix: ${sha}\n\nlonger body`,
      author: { name: 'Me', date: '2026-10-15T10:00:00Z' }
    },
    author: { login: 'me', avatar_url: 'https://avatars/me' },
    repository: { full_name: 'me/app' },
    ...patch
  }
}

describe('홈 활동 수집(매핑)', () => {
  it('기여 달력: 주를 펼쳐 날짜 순, 모르는 수준은 NONE, 날짜 없는 칸은 버린다', async () => {
    const { client, calls } = fakeGitHub({
      graphql: { [OPERATIONS.contributions]: () => contributionsResponse() }
    })
    const result = await collectContributions({ client })
    expect(calls.map((c) => c.key)).toEqual(['GdeskContributions'])
    expect(result).toEqual({
      login: 'me',
      totalCommitContributions: 412,
      days: [
        { date: '2026-10-11', count: 0, level: 'NONE' },
        { date: '2026-10-12', count: 3, level: 'SECOND_QUARTILE' },
        { date: '2026-10-13', count: 9, level: 'FOURTH_QUARTILE' },
        { date: '2026-10-14', count: 1, level: 'NONE' },
        { date: '2026-10-15', count: 2, level: 'THIRD_QUARTILE' },
        { date: '2026-10-16', count: 0, level: 'NONE' }
      ]
    })
  })

  it('커밋 검색: author:<login>, 작성 시각 최신 순, 5개, 첫 줄 메시지', async () => {
    const { client, calls } = fakeGitHub({
      rest: {
        'GET /search/commits': () =>
          json({
            total_count: 40,
            incomplete_results: false,
            items: [
              commitItem('a1'),
              commitItem('b2', { author: null }),
              { sha: null },
              commitItem('c3', { repository: null })
            ]
          })
      }
    })
    const items = await collectRecentCommits({ client, login: 'me' })
    expect(REST_ENDPOINTS.searchCommits).toBe('GET /search/commits')
    const url = new URL(calls[0]!.url)
    expect(url.pathname).toBe('/search/commits')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'author:me',
      sort: 'author-date',
      order: 'desc',
      per_page: '5'
    })
    expect(items).toEqual([
      {
        repoFullName: 'me/app',
        sha: 'a1',
        message: 'fix: a1',
        authorAvatarUrl: 'https://avatars/me',
        authorDate: '2026-10-15T10:00:00Z',
        url: 'https://github.com/me/app/commit/a1'
      },
      {
        repoFullName: 'me/app',
        sha: 'b2',
        message: 'fix: b2',
        authorAvatarUrl: null,
        authorDate: '2026-10-15T10:00:00Z',
        url: 'https://github.com/me/app/commit/b2'
      }
    ])
  })
})

describe('홈 활동 갱신(캐시 쓰기)', () => {
  let db: DatabaseSync
  let unregister: () => void
  beforeEach(() => {
    db = openDatabase(':memory:')
    unregister = registerFetchedDataCleaner(clearCache)
  })
  afterEach(() => {
    unregister()
    db.close()
  })

  it('기여: 달력과 커밋 수를 저장하고 동기화 시각을 남긴다', async () => {
    const { client } = fakeGitHub({
      graphql: { [OPERATIONS.contributions]: () => contributionsResponse() }
    })
    expect(getContributions(db)).toBeNull()
    await refreshContributions({ db, client, now: NOW, isCurrent: currentDataGuard() })
    const saved = getContributions(db)
    expect(saved?.totalCommitContributions).toBe(412)
    expect(saved?.days.map((d) => d.date)).toEqual([
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16'
    ])
    expect(saved?.days[1]).toEqual({ date: '2026-10-12', count: 3, level: 'SECOND_QUARTILE' })
    expect(getSyncState(db, SYNC_SCOPES.contributions).lastSyncedAt).toBe(NOW)

    // 다시 받으면 통째로 바꾼다
    const { client: next } = fakeGitHub({
      graphql: {
        [OPERATIONS.contributions]: () => ({
          data: {
            viewer: {
              login: 'me',
              contributionsCollection: {
                totalCommitContributions: 1,
                contributionCalendar: { weeks: [{ contributionDays: [day('2026-10-17', 1)] }] }
              }
            }
          }
        })
      }
    })
    await refreshContributions({ db, client: next, now: NOW + 1 })
    expect(getContributions(db)).toEqual({
      totalCommitContributions: 1,
      days: [{ date: '2026-10-17', count: 1, level: 'FIRST_QUARTILE' }]
    })
  })

  it('최근 커밋: 순서대로 저장하고 다시 받으면 바꾼다', async () => {
    let round = 0
    const { client } = fakeGitHub({
      rest: {
        'GET /search/commits': () => {
          round++
          return json({
            total_count: 2,
            items: round === 1 ? [commitItem('a1'), commitItem('b2')] : [commitItem('z9')]
          })
        }
      }
    })
    await refreshRecentCommits({ db, client, login: 'me', now: NOW })
    expect(listRecentCommits(db).map((c) => c.sha)).toEqual(['a1', 'b2'])
    expect(getSyncState(db, SYNC_SCOPES.recentCommits).lastSyncedAt).toBe(NOW)
    await refreshRecentCommits({ db, client, login: 'me', now: NOW })
    expect(listRecentCommits(db).map((c) => c.sha)).toEqual(['z9'])
  })

  it('로그인 이름을 모르면 요청하지 않고 아무것도 쓰지 않는다', async () => {
    const { client, calls } = fakeGitHub({})
    await refreshRecentCommits({ db, client, login: null, now: NOW })
    expect(calls).toEqual([])
    expect(getSyncState(db, SYNC_SCOPES.recentCommits).lastSyncedAt).toBeNull()
  })

  it('받는 사이 로그아웃하면 기여 달력을 쓰지 않는다(세대 확인)', async () => {
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.contributions]: () => {
          clearFetchedData(db)
          return contributionsResponse()
        }
      }
    })
    await expect(
      refreshContributions({ db, client, now: NOW, isCurrent: currentDataGuard() })
    ).rejects.toBeInstanceOf(StaleRefreshError)
    expect(getContributions(db)).toBeNull()
    expect(db.prepare('SELECT COUNT(*) AS n FROM cache_contribution_days').get()).toEqual({ n: 0 })
    expect(getSyncState(db, SYNC_SCOPES.contributions).lastSyncedAt).toBeNull()
  })

  it('받는 사이 로그아웃하면 최근 커밋을 쓰지 않는다(세대 확인)', async () => {
    const { client } = fakeGitHub({
      rest: {
        'GET /search/commits': () => {
          clearFetchedData(db)
          return json({ total_count: 1, items: [commitItem('a1')] })
        }
      }
    })
    await expect(
      refreshRecentCommits({ db, client, login: 'me', now: NOW, isCurrent: currentDataGuard() })
    ).rejects.toBeInstanceOf(StaleRefreshError)
    expect(listRecentCommits(db)).toEqual([])
    expect(getSyncState(db, SYNC_SCOPES.recentCommits).lastSyncedAt).toBeNull()
  })

  it('로그아웃하면 홈 활동 캐시도 지워진다', async () => {
    const { client } = fakeGitHub({
      graphql: { [OPERATIONS.contributions]: () => contributionsResponse() },
      rest: {
        'GET /search/commits': () => json({ total_count: 1, items: [commitItem('a1')] })
      }
    })
    await refreshContributions({ db, client, now: NOW })
    await refreshRecentCommits({ db, client, login: 'me', now: NOW })
    clearFetchedData(db)
    expect(getContributions(db)).toBeNull()
    expect(listRecentCommits(db)).toEqual([])
  })

  it('가짜 서버가 모르는 요청(GraphQL 오류·REST 404)은 던지고 캐시를 건드리지 않는다', async () => {
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.contributions]: () => ({ errors: [{ message: 'no handler' }] })
      }
    })
    await expect(refreshContributions({ db, client, now: NOW })).rejects.toThrow()
    await expect(refreshRecentCommits({ db, client, login: 'me', now: NOW })).rejects.toThrow()
    expect(getContributions(db)).toBeNull()
    expect(listRecentCommits(db)).toEqual([])
  })
})
