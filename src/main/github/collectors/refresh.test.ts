import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../db/connection'
import { listOrgRestrictions } from '../../cache/org-restrictions'
import { listNotifications, replaceNotifications } from '../../cache/notifications'
import { getRepository, listMyRepositories, replaceMyRepositories } from '../../cache/repositories'
import { getSyncState, updateSyncState } from '../../cache/sync-state'
import { listIncomingIssues } from '../../cache/issues'
import { listIncomingPullRequests } from '../../cache/pull-requests'
import { getRepositoryDetail } from '../../cache/repo-detail'
import { notificationRecord, repoRecord } from '../../cache/test-fixtures'
import { OPERATIONS } from './queries'
import {
  SYNC_SCOPES,
  refreshMyRepositories,
  refreshNotifications,
  refreshRepoOpenItems,
  refreshRepositoryDetails
} from './refresh'
import { fakeGitHub, json, orgRestrictionError, rawIssue, rawPr, rawRepo } from './test-server'

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
      }
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
    expect(listIncomingPullRequests(db).map((p) => p.id)).toEqual(['P'])
    expect(listIncomingIssues(db).map((i) => i.id)).toEqual(['I'])
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
})
