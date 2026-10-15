import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearCache } from '../../cache/cleaner'
import { clearFetchedData, currentDataGuard, registerFetchedDataCleaner } from '../../db/cleanup'
import { openDatabase } from '../../db/connection'
import { listOrgRestrictions, recordOrgRestrictions } from '../../cache/org-restrictions'
import {
  listNotifications,
  removeNotification,
  replaceNotifications
} from '../../cache/notifications'
import {
  getRepository,
  listMyRepositories,
  replaceMyRepositories,
  setRepositoryAccessStatus
} from '../../cache/repositories'
import { getSyncState, updateSyncState } from '../../cache/sync-state'
import { listIncomingIssues } from '../../cache/issues'
import { listIncomingPullRequests } from '../../cache/pull-requests'
import { getRepositoryDetail } from '../../cache/repo-detail'
import { notificationRecord, repoRecord } from '../../cache/test-fixtures'
import { OPERATIONS } from './queries'
import { StaleRefreshError } from './common'
import {
  SYNC_SCOPES,
  refreshMyRepositories,
  refreshNotifications,
  refreshRepoOpenItems,
  refreshRepositoryDetails
} from './refresh'
import {
  TEST_BASE,
  fakeGitHub,
  json,
  link,
  orgRestrictionError,
  rawIssue,
  rawPr,
  rawRepo
} from './test-server'

const NOW = Date.UTC(2026, 9, 15, 12)

describe('refresh (수집 → 캐시)', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('내 저장소: 저장, 조직 제한 기록, 동기화 시각', async () => {
    replaceMyRepositories(db, [repoRecord(1), repoRecord(2)])
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.myRepositories]: () => ({
          data: {
            viewer: {
              login: 'me',
              repositories: {
                pageInfo: { hasNextPage: false },
                nodes: [rawRepo(1, { name: 'renamed' }), null]
              }
            }
          },
          errors: [orgRestrictionError('acme')]
        })
      },
      rest: { 'GET /repositories/2': () => json({ message: 'Not Found' }, 404) }
    })
    const result = await refreshMyRepositories({ db, client, pinnedRepoIds: [2], now: NOW })
    expect(result.items.map((r) => r.id)).toEqual([1])
    expect(listMyRepositories(db).map((r) => r.fullName)).toEqual(['me/renamed'])
    expect(getRepository(db, 2)).toMatchObject({ isMine: false, accessStatus: 'unavailable' })
    expect(listOrgRestrictions(db)).toEqual([
      expect.objectContaining({
        orgLogin: 'acme',
        reason: 'oauth_app_restriction',
        recordedAt: NOW
      })
    ])
    expect(getSyncState(db, SYNC_SCOPES.repositories).lastSyncedAt).toBe(NOW)
  })

  it('불완전한 수집이면 집합을 바꾸지 않고 머리글만 갱신한다', async () => {
    replaceMyRepositories(db, [repoRecord(1), repoRecord(2)])
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.myRepositories]: () => ({ data: null, errors: [orgRestrictionError('acme')] })
      }
    })
    await refreshMyRepositories({ db, client, now: NOW })
    expect(
      listMyRepositories(db)
        .map((r) => r.id)
        .sort()
    ).toEqual([1, 2])
    expect(listOrgRestrictions(db)).toHaveLength(1)
    expect(getSyncState(db, SYNC_SCOPES.repositories).lastSyncedAt).toBeNull()
  })

  it('들어온 항목: 캐시의 내 저장소로 묶음 수집 후 저장', async () => {
    replaceMyRepositories(db, [repoRecord(1, { openPullRequestCount: 1, openIssueCount: 1 })])
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.repoOpenItems]: () => ({
          data: {
            viewer: { login: 'me' },
            nodes: [
              {
                databaseId: 1,
                openPullRequests: { totalCount: 1, nodes: [rawPr('P', 1)] },
                openIssues: { totalCount: 1, nodes: [rawIssue('I', 1)] }
              }
            ]
          }
        })
      }
    })
    await refreshRepoOpenItems({ db, client, now: NOW })
    expect(listIncomingPullRequests(db).items.map((p) => p.id)).toEqual(['P'])
    expect(listIncomingIssues(db).items.map((i) => i.id)).toEqual(['I'])
  })

  it('알림 304: 캐시를 그대로 두고 폴링 간격만 갱신', async () => {
    replaceNotifications(db, [notificationRecord('1')])
    updateSyncState(db, SYNC_SCOPES.notifications, { etag: 'W/"e"', lastSyncedAt: 1 })
    const { client, calls } = fakeGitHub({
      rest: { 'GET /notifications': () => json(null, 304, { 'x-poll-interval': '90' }) }
    })
    const result = await refreshNotifications({ db, client, now: NOW })
    expect(calls[0]?.headers.get('if-none-match')).toBe('W/"e"')
    expect(result).toEqual({ notModified: true, pollInterval: 90 })
    expect(listNotifications(db).map((n) => n.threadId)).toEqual(['1'])
    expect(getSyncState(db, SYNC_SCOPES.notifications)).toMatchObject({
      etag: 'W/"e"',
      pollInterval: 90,
      lastSyncedAt: NOW
    })
  })

  it('알림 200: 목록을 바꾸고 etag 를 저장', async () => {
    replaceNotifications(db, [notificationRecord('old')])
    const { client } = fakeGitHub({
      rest: {
        'GET /notifications': () =>
          json(
            [
              {
                id: '5',
                unread: true,
                reason: 'mention',
                updated_at: '2026-10-10T00:00:00Z',
                subject: { title: 't', url: null, type: 'Issue' },
                repository: {
                  id: 1,
                  full_name: 'me/repo1',
                  html_url: 'https://github.com/me/repo1'
                }
              }
            ],
            200,
            { etag: 'W/"new"', 'x-poll-interval': '60' }
          )
      }
    })
    const result = await refreshNotifications({ db, client, now: NOW })
    expect(result).toEqual({ notModified: false, pollInterval: 60 })
    expect(listNotifications(db).map((n) => n.threadId)).toEqual(['5'])
    expect(getSyncState(db, SYNC_SCOPES.notifications).etag).toBe('W/"new"')
  })

  it('저장소 상세: 404 면 unavailable, 고정은 건드리지 않는다', async () => {
    replaceMyRepositories(db, [repoRecord(1)])
    db.exec('INSERT INTO pins (repo_id, position) VALUES (1, 0)')
    db.prepare('UPDATE cache_repositories SET node_id = NULL WHERE id = 1').run()
    const { client } = fakeGitHub({
      rest: { 'GET /repositories/1': () => json({ message: 'Not Found' }, 404) }
    })
    const result = await refreshRepositoryDetails({ db, client, repoIds: [1], now: NOW })
    expect(result.results).toEqual([{ repoId: 1, status: 'unavailable', reason: 'not_found' }])
    expect(getRepository(db, 1)?.accessStatus).toBe('unavailable')
    expect(Number(db.prepare('SELECT COUNT(*) AS n FROM pins').get()?.n)).toBe(1)
  })

  it('저장소 상세: 성공하면 저장하고 available 로 되돌린다', async () => {
    replaceMyRepositories(db, [repoRecord(1)], {})
    db.prepare("UPDATE cache_repositories SET access_status = 'unavailable' WHERE id = 1").run()
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.repositoryDetail]: () => ({
          data: {
            viewer: { login: 'me' },
            node: {
              ...rawRepo(1),
              openPullRequests: { totalCount: 0, nodes: [] },
              openIssues: { totalCount: 0, nodes: [] },
              defaultBranchRef: { name: 'main', target: { history: { nodes: [] } } },
              latestRelease: null,
              releases: { totalCount: 0, nodes: [] },
              languages: { totalSize: 0, edges: [] }
            }
          }
        })
      },
      rest: {
        'GET /repos/me/repo1/contributors': () => json([]),
        'GET /repos/me/repo1/stargazers': () => json([])
      }
    })
    await refreshRepositoryDetails({ db, client, repoIds: [1], now: NOW })
    const detail = getRepositoryDetail(db, 1, { now: NOW })
    expect(detail?.repository.accessStatus).toBe('available')
    expect(detail?.detailSyncedAt).toBe(NOW)
    expect(getSyncState(db, 'repo:1').lastSyncedAt).toBe(NOW)
  })

  it('알림 페이지 한도에 닿으면(불완전) 기존 알림을 지우지 않고 합친다', async () => {
    replaceNotifications(db, [notificationRecord('old', { updatedAt: '2026-01-01T00:00:00Z' })])
    const { client } = fakeGitHub({
      rest: {
        'GET /notifications': (url) =>
          json([thread(url.searchParams.get('page') ?? '1')], 200, {
            link: link({
              next: `${TEST_BASE}/notifications?page=${Number(url.searchParams.get('page') ?? 1) + 1}`
            })
          })
      }
    })
    await refreshNotifications({ db, client, now: NOW, maxPages: 2 })
    expect(
      listNotifications(db)
        .map((n) => n.threadId)
        .sort()
    ).toEqual(['1', '2', 'old'])
  })

  it('완료한 알림은 같은 갱신 시각으로 다시 와도 숨고, 새 활동이면 다시 보인다', async () => {
    let updatedAt = '2026-10-10T00:00:00Z'
    const { client } = fakeGitHub({
      rest: { 'GET /notifications': () => json([thread('7', { updated_at: updatedAt })]) }
    })
    await refreshNotifications({ db, client, now: NOW })
    expect(removeNotification(db, '7')).not.toBeNull()
    await refreshNotifications({ db, client, now: NOW })
    expect(listNotifications(db)).toEqual([])
    updatedAt = '2026-10-12T00:00:00Z'
    await refreshNotifications({ db, client, now: NOW })
    expect(listNotifications(db).map((n) => n.threadId)).toEqual(['7'])
  })

  it('내 저장소를 다시 모두 받으면 이번에 제한이 없던 조직의 안내를 지운다', async () => {
    let restricted = true
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.myRepositories]: () => ({
          data: {
            viewer: {
              login: 'me',
              repositories: { pageInfo: { hasNextPage: false }, nodes: [rawRepo(1)] }
            }
          },
          errors: restricted ? [orgRestrictionError('acme')] : []
        })
      }
    })
    recordOrgRestrictions(db, [{ reason: 'saml_enforcement', orgLogin: 'other', message: 'x' }])
    await refreshMyRepositories({ db, client, now: NOW })
    expect(listOrgRestrictions(db).map((r) => r.orgLogin)).toEqual(['acme'])
    restricted = false
    await refreshMyRepositories({ db, client, now: NOW })
    expect(listOrgRestrictions(db)).toEqual([])
  })

  it('저장소 상세가 성공하면 그 조직의 제한 안내를 지운다', async () => {
    recordOrgRestrictions(db, [{ reason: 'saml_enforcement', orgLogin: 'me', message: 'x' }])
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.repositoryDetail]: () => ({
          data: {
            viewer: { login: 'me' },
            node: {
              ...rawRepo(1),
              openPullRequests: { totalCount: 0, nodes: [] },
              openIssues: { totalCount: 0, nodes: [] },
              defaultBranchRef: { name: 'main', target: { history: { nodes: [] } } },
              latestRelease: null,
              releases: { totalCount: 0, nodes: [] },
              languages: { totalSize: 0, edges: [] }
            }
          }
        })
      },
      rest: {
        'GET /repos/me/repo1/contributors': () => json([]),
        'GET /repos/me/repo1/stargazers': () => json([])
      }
    })
    replaceMyRepositories(db, [repoRecord(1)])
    await refreshRepositoryDetails({ db, client, repoIds: [1], now: NOW })
    expect(listOrgRestrictions(db)).toEqual([])
  })
})

function myRepos(ids: readonly number[]) {
  return () => ({
    data: {
      viewer: {
        login: 'me',
        repositories: { pageInfo: { hasNextPage: false }, nodes: ids.map((id) => rawRepo(id)) }
      }
    }
  })
}

describe('내 집합에서 빠진 고정·연결 저장소의 접근 확인 (spec §3)', () => {
  let db: DatabaseSync
  beforeEach(() => {
    db = openDatabase(':memory:')
    replaceMyRepositories(
      db,
      [1, 2, 3, 4, 5, 6].map((id) => repoRecord(id))
    )
  })
  afterEach(() => db.close())

  it('404·403·410·451 이면 unavailable, 200 이면 available, 고정·연결 아닌 것은 묻지 않는다', async () => {
    setRepositoryAccessStatus(db, 3, 'unavailable')
    const { client, calls } = fakeGitHub({
      graphql: { [OPERATIONS.myRepositories]: myRepos([1]) },
      rest: {
        'GET /repositories/2': () => json({ message: 'Not Found' }, 404),
        // 쓰기 권한만 잃은 공개 저장소: 아직 읽을 수 있으므로 available
        'GET /repositories/3': () => json({ id: 3, node_id: 'R_3', full_name: 'me/repo3' }),
        'GET /repositories/4': () => json({ message: 'Forbidden' }, 403),
        'GET /repositories/5': () => json({ message: 'Repository access blocked' }, 451)
      }
    })
    await refreshMyRepositories({
      db,
      client,
      pinnedRepoIds: [2, 3],
      linkedRepoIds: [4, 5],
      now: NOW
    })
    expect(getRepository(db, 2)).toMatchObject({ isMine: false, accessStatus: 'unavailable' })
    expect(getRepository(db, 3)).toMatchObject({ isMine: false, accessStatus: 'available' })
    expect(getRepository(db, 4)).toMatchObject({ isMine: false, accessStatus: 'unavailable' })
    expect(getRepository(db, 5)).toMatchObject({ isMine: false, accessStatus: 'unavailable' })
    // 고정·연결이 아닌 저장소(6)는 확인하지 않고 상태도 그대로
    expect(getRepository(db, 6)).toMatchObject({ isMine: false, accessStatus: 'available' })
    expect(calls.filter((c) => c.key.startsWith('GET /repositories/')).map((c) => c.key)).toEqual([
      'GET /repositories/2',
      'GET /repositories/3',
      'GET /repositories/4',
      'GET /repositories/5'
    ])
  })

  it('연결만 된 저장소가 410 이면 unavailable', async () => {
    const { client } = fakeGitHub({
      graphql: { [OPERATIONS.myRepositories]: myRepos([1, 3, 4, 5, 6]) },
      rest: { 'GET /repositories/2': () => json({ message: 'Gone' }, 410) }
    })
    await refreshMyRepositories({ db, client, linkedRepoIds: [2], now: NOW })
    expect(getRepository(db, 2)).toMatchObject({ isMine: false, accessStatus: 'unavailable' })
  })

  it('500 같은 다른 실패면 상태를 바꾸지 않고 나머지 확인을 멈추며, 집합은 바꾼다', async () => {
    setRepositoryAccessStatus(db, 3, 'unavailable')
    const { client, calls } = fakeGitHub({
      graphql: { [OPERATIONS.myRepositories]: myRepos([1, 4, 5, 6]) },
      rest: {
        'GET /repositories/2': () => json({ message: 'boom' }, 500),
        'GET /repositories/3': () => json({ id: 3 })
      }
    })
    await refreshMyRepositories({ db, client, pinnedRepoIds: [2, 3], now: NOW })
    expect(getRepository(db, 2)).toMatchObject({ isMine: false, accessStatus: 'available' })
    expect(getRepository(db, 3)).toMatchObject({ isMine: false, accessStatus: 'unavailable' })
    expect(calls.some((c) => c.key === 'GET /repositories/3')).toBe(false)
    expect(getSyncState(db, SYNC_SCOPES.repositories).lastSyncedAt).toBe(NOW)
  })
})

describe('갱신 중 로그아웃·계정 전환 (이전 계정 정보가 남지 않게)', () => {
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

  it('받는 사이 로그아웃(clearFetchedData)하면 응답이 와도 캐시에 아무것도 쓰지 않는다', async () => {
    const { client } = fakeGitHub({
      graphql: {
        [OPERATIONS.myRepositories]: () => {
          // 응답이 돌아오기 전에 사용자가 로그아웃한다
          clearFetchedData(db)
          return myRepos([1, 2])()
        }
      }
    })
    await expect(
      refreshMyRepositories({ db, client, isCurrent: currentDataGuard(), now: NOW })
    ).rejects.toBeInstanceOf(StaleRefreshError)
    expect(db.prepare('SELECT COUNT(*) AS n FROM cache_repositories').get()).toEqual({ n: 0 })
    expect(getSyncState(db, SYNC_SCOPES.repositories).lastSyncedAt).toBeNull()
  })

  it('상세 갱신도 지운 뒤에는 unavailable 자리 행조차 만들지 않는다', async () => {
    const { client } = fakeGitHub({
      rest: {
        'GET /repositories/9': () => {
          clearFetchedData(db)
          return json({ message: 'Not Found' }, 404)
        }
      }
    })
    await expect(
      refreshRepositoryDetails({
        db,
        client,
        repoIds: [9],
        isCurrent: currentDataGuard(),
        now: NOW
      })
    ).rejects.toBeInstanceOf(StaleRefreshError)
    expect(db.prepare('SELECT COUNT(*) AS n FROM cache_repositories').get()).toEqual({ n: 0 })
  })

  it('세대가 그대로면 평소처럼 쓴다', async () => {
    const { client } = fakeGitHub({ graphql: { [OPERATIONS.myRepositories]: myRepos([1]) } })
    await refreshMyRepositories({ db, client, isCurrent: currentDataGuard(), now: NOW })
    expect(listMyRepositories(db).map((r) => r.id)).toEqual([1])
  })
})

function thread(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    unread: true,
    reason: 'mention',
    updated_at: '2026-10-10T00:00:00Z',
    subject: { title: `t${id}`, url: null, type: 'Issue' },
    repository: { id: 1, full_name: 'me/repo1', html_url: 'https://github.com/me/repo1' },
    ...patch
  }
}
