import type { DatabaseSync } from 'node:sqlite'
import { getDb } from '../../db/db'
import { replaceIssues, replaceRepoIssues } from '../../cache/issues'
import { mergeNotifications, replaceNotifications } from '../../cache/notifications'
import {
  clearOrgRestrictions,
  clearOrgRestrictionsExcept,
  recordOrgRestrictions
} from '../../cache/org-restrictions'
import { replacePullRequests, replaceRepoPullRequests } from '../../cache/pull-requests'
import { saveRepositoryDetail } from '../../cache/repo-detail'
import {
  getRepositoryRefs,
  listMyRepositoryRefs,
  markRepositoryUnavailable,
  replaceMyRepositories,
  replaceStarredRepositories,
  upsertRepositories
} from '../../cache/repositories'
import { getSyncState, updateSyncState } from '../../cache/sync-state'
import type { RepositoryRecord, StarredRepositoryRecord } from '../../cache/types'
import { withTransaction } from '../../db/transaction'
import type { OrgRestriction } from '../client'
import type { CollectorOptions, ListResult } from './common'
import { collectRepoOpenItems } from './items'
import type { RepoOpenItemsOptions, RepoOpenItemsTarget } from './items'
import { collectNotifications } from './notifications'
import { collectRepositoryDetails } from './repo-detail'
import type { RepoDetailOptions, RepoDetailOutcome } from './repo-detail'
import { collectMyRepositories, collectStarredRepositories } from './repositories'
import type { PagedOptions } from './repositories'
import {
  collectAssignedIssues,
  collectMyIssues,
  collectMyPullRequests,
  collectReviewRequests
} from './search'
import type { SearchOptions } from './search'

/**
 * 수집 → 캐시 반영. 동기화 엔진(언제 부를지 결정)은 이 함수들을 부르기만 하면 된다.
 * - 조직 접근 제한은 캐시에 기록하고 수집 전체를 실패시키지 않는다.
 * - 네트워크·한도·세션 오류는 그대로 던진다(연결 상태는 GitHub 요청 계층이 관리).
 * - 범위별 마지막 동기화 시각을 cache_sync_state 에 남긴다.
 */
export const SYNC_SCOPES = {
  repositories: 'repositories',
  starred: 'starred',
  repoOpenItems: 'repo_open_items',
  myPullRequests: 'my_pull_requests',
  reviewRequests: 'review_requests',
  assignedIssues: 'assigned_issues',
  myIssues: 'my_issues',
  notifications: 'notifications'
} as const

/** 저장소 상세의 동기화 범위 이름 */
export function repoSyncScope(repoId: number): string {
  return `repo:${repoId}`
}

export interface RefreshContext extends CollectorOptions {
  /** 기본 getDb() */
  db?: DatabaseSync
  /** 기본 Date.now() */
  now?: number
}

function ctx(options: RefreshContext): { db: DatabaseSync; now: number } {
  return { db: options.db ?? getDb(), now: options.now ?? Date.now() }
}

function record(db: DatabaseSync, restrictions: readonly OrgRestriction[], now: number): void {
  recordOrgRestrictions(db, restrictions, now)
}

/**
 * 내 저장소 집합을 받아 저장한다. 모두 받았을 때만 집합을 바꾸고(빠진 고정 저장소는 unavailable),
 * 조직 제한 등으로 불완전하면 받은 머리글만 갱신한다. 모두 받았으면 이번에 제한이 없던 조직의 안내를 지운다.
 */
export async function refreshMyRepositories(
  options: RefreshContext & PagedOptions & { pinnedRepoIds?: readonly number[] } = {}
): Promise<ListResult<RepositoryRecord> & { viewerLogin: string | null }> {
  const { db, now } = ctx(options)
  const result = await collectMyRepositories(options)
  withTransaction(db, () => {
    if (result.complete) {
      replaceMyRepositories(db, result.items, { pinnedRepoIds: options.pinnedRepoIds, now })
      updateSyncState(db, SYNC_SCOPES.repositories, { lastSyncedAt: now })
      // 모두 받았으므로 이번에 제한이 없던 조직의 안내는 지운다
      clearOrgRestrictionsExcept(db, result.orgRestrictions)
    } else {
      upsertRepositories(db, result.items, now)
    }
    record(db, result.orgRestrictions, now)
  })
  return result
}

/** 스타한 저장소를 받아 저장한다 */
export async function refreshStarredRepositories(
  options: RefreshContext & PagedOptions = {}
): Promise<ListResult<StarredRepositoryRecord>> {
  const { db, now } = ctx(options)
  const result = await collectStarredRepositories(options)
  withTransaction(db, () => {
    if (result.complete) {
      replaceStarredRepositories(db, result.items, now)
      updateSyncState(db, SYNC_SCOPES.starred, { lastSyncedAt: now })
    } else {
      upsertRepositories(
        db,
        result.items.map((i) => i.repository),
        now
      )
    }
    record(db, result.orgRestrictions, now)
  })
  return result
}

/**
 * 내 저장소 집합의 열린 PR·이슈(들어온 PR·이슈의 근거)를 받아 저장소별로 바꾼다.
 * targets 를 주지 않으면 캐시의 내 저장소 집합(열린 수·노드 ID)을 쓴다. 받지 못한 저장소는 기존 캐시를 둔다.
 */
export async function refreshRepoOpenItems(
  options: RefreshContext & RepoOpenItemsOptions & { targets?: readonly RepoOpenItemsTarget[] } = {}
): Promise<{ repoIds: number[]; orgRestrictions: OrgRestriction[] }> {
  const { db, now } = ctx(options)
  const targets = options.targets ?? listMyRepositoryRefs(db)
  const result = await collectRepoOpenItems(targets, options)
  withTransaction(db, () => {
    for (const repo of result.repos) {
      replaceRepoPullRequests(db, repo.repoId, repo.pullRequests, {
        totalCount: repo.pullRequestTotal
      })
      replaceRepoIssues(db, repo.repoId, repo.issues, { totalCount: repo.issueTotal })
    }
    updateSyncState(db, SYNC_SCOPES.repoOpenItems, { lastSyncedAt: now })
    record(db, result.orgRestrictions, now)
  })
  return { repoIds: result.repos.map((r) => r.repoId), orgRestrictions: result.orgRestrictions }
}

/** 검색 issueCount 를 목록 전체 수로 넘긴다(상한에 잘린 목록의 수치·완전성) */
function total(result: ListResult<unknown>): { totalCount?: number } {
  return result.totalCount === null ? {} : { totalCount: result.totalCount }
}

function shouldReplace(result: ListResult<unknown>): boolean {
  // 첫 페이지부터 조직 제한으로 막혔으면(빈 불완전 결과) 기존 목록을 지우지 않는다
  return result.complete || result.items.length > 0
}

/** 내가 올린 PR 과 리뷰 요청 목록을 받아 저장한다 */
export async function refreshPullRequestLists(
  options: RefreshContext & SearchOptions = {}
): Promise<{ orgRestrictions: OrgRestriction[] }> {
  const { db, now } = ctx(options)
  const mine = await collectMyPullRequests(options)
  const reviews = await collectReviewRequests(options)
  withTransaction(db, () => {
    if (shouldReplace(mine)) {
      replacePullRequests(db, 'mine', mine.items, total(mine))
      updateSyncState(db, SYNC_SCOPES.myPullRequests, { lastSyncedAt: now })
    }
    if (shouldReplace(reviews)) {
      replacePullRequests(db, 'review_requested', reviews.items, total(reviews))
      updateSyncState(db, SYNC_SCOPES.reviewRequests, { lastSyncedAt: now })
    }
    record(db, [...mine.orgRestrictions, ...reviews.orgRestrictions], now)
  })
  return { orgRestrictions: [...mine.orgRestrictions, ...reviews.orgRestrictions] }
}

/** 나에게 할당된 이슈와 내가 올린 이슈 목록을 받아 저장한다 */
export async function refreshIssueLists(
  options: RefreshContext & SearchOptions = {}
): Promise<{ orgRestrictions: OrgRestriction[] }> {
  const { db, now } = ctx(options)
  const assigned = await collectAssignedIssues(options)
  const mine = await collectMyIssues(options)
  withTransaction(db, () => {
    if (shouldReplace(assigned)) {
      replaceIssues(db, 'assigned', assigned.items, total(assigned))
      updateSyncState(db, SYNC_SCOPES.assignedIssues, { lastSyncedAt: now })
    }
    if (shouldReplace(mine)) {
      replaceIssues(db, 'mine', mine.items, total(mine))
      updateSyncState(db, SYNC_SCOPES.myIssues, { lastSyncedAt: now })
    }
    record(db, [...assigned.orgRestrictions, ...mine.orgRestrictions], now)
  })
  return { orgRestrictions: [...assigned.orgRestrictions, ...mine.orgRestrictions] }
}

/**
 * 알림을 조건부 요청으로 받는다. 304 면 캐시를 두고 폴링 간격·동기화 시각만 갱신한다.
 * pollInterval(초)은 다음 폴링까지 지켜야 하는 GitHub 최소 간격이다.
 */
export async function refreshNotifications(
  options: RefreshContext & { maxPages?: number; perPage?: number } = {}
): Promise<{ notModified: boolean; pollInterval: number | null }> {
  const { db, now } = ctx(options)
  const state = getSyncState(db, SYNC_SCOPES.notifications)
  const result = await collectNotifications({
    ...options,
    etag: state.etag,
    lastModified: state.lastModified
  })
  withTransaction(db, () => {
    if (!result.notModified) {
      // 페이지 한도로 잘렸으면 오래된 알림을 지우지 않도록 합친다
      if (result.complete) replaceNotifications(db, result.notifications)
      else mergeNotifications(db, result.notifications)
    }
    updateSyncState(db, SYNC_SCOPES.notifications, {
      lastSyncedAt: now,
      etag: result.etag,
      lastModified: result.lastModified,
      pollInterval: result.pollInterval ?? state.pollInterval
    })
  })
  return {
    notModified: result.notModified,
    pollInterval: result.pollInterval ?? state.pollInterval
  }
}

/**
 * 상세 추적 저장소의 상세 정보를 받아 저장한다. 접근 불가(404·권한 상실·조직 제한)면 unavailable 로 표시한다.
 * 고정·연결은 건드리지 않는다.
 */
export async function refreshRepositoryDetails(
  options: RefreshContext & Omit<RepoDetailOptions, 'now'> & { repoIds: readonly number[] }
): Promise<{ results: RepoDetailOutcome[]; orgRestrictions: OrgRestriction[] }> {
  const { db, now } = ctx(options)
  const refs = new Map(getRepositoryRefs(db, options.repoIds).map((r) => [r.id, r]))
  const targets = [...new Set(options.repoIds)].map((repoId) => ({
    repoId,
    nodeId: refs.get(repoId)?.nodeId ?? null
  }))
  const result = await collectRepositoryDetails(targets, { ...options, now })
  withTransaction(db, () => {
    for (const outcome of result.results) {
      if (outcome.status === 'ok') {
        saveRepositoryDetail(db, outcome.detail, now)
        // 그 소유자(조직)의 정보를 다시 받았으므로 제한 안내를 지운다(이번에 다시 제한되면 아래에서 기록)
        clearOrgRestrictions(db, outcome.detail.repository.owner)
      } else {
        markRepositoryUnavailable(db, outcome.repoId, now)
      }
      updateSyncState(db, repoSyncScope(outcome.repoId), { lastSyncedAt: now })
    }
    record(db, result.orgRestrictions, now)
  })
  return result
}
