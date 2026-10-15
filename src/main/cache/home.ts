import type { DatabaseSync } from 'node:sqlite'
import type {
  ContributionItem,
  CountedList,
  HomeSummary,
  SidebarCounts,
  StarChangeItem
} from '@shared/domain/home'
import { STAR_HOME_WINDOW_DAYS } from '@shared/domain/stats'
import { isUnansweredContribution } from '../domain/contribution'
import type { UnansweredOptions } from '../domain/contribution'
import { composeFailedCi } from '../domain/failed-ci'
import { isIncomingIssuesComplete, listIncomingIssueRecords } from './issues'
import {
  countUnreadNotifications,
  isNotificationListComplete,
  listNotifications
} from './notifications'
import {
  countIncomingPullRequests,
  countReviewRequests,
  isIncomingPullRequestsComplete,
  listIncomingPullRequestRecords,
  listMyPullRequests,
  listReviewRequests
} from './pull-requests'
import { getStarGrowth, listTrackedRepoHeads } from './repo-detail'
import { getRepositories } from './repositories'
import type { IssueRecord, PullRequestRecord } from './types'

/** Home 카드 (spec §4.2). 계산 규칙은 src/main/domain 의 순수 함수를 그대로 쓴다 */

function strip<T extends PullRequestRecord | IssueRecord>(
  record: T
): Omit<T, 'authorAssociation' | 'viewerIsAuthor' | 'hasWriteHolderResponse'> {
  const { authorAssociation: _a, viewerIsAuthor: _v, hasWriteHolderResponse: _h, ...row } = record
  return row
}

function facts(r: PullRequestRecord | IssueRecord) {
  return {
    authorAssociation: r.authorAssociation,
    authorIsBot: r.author.isBot,
    hasWriteHolderResponse: r.hasWriteHolderResponse
  }
}

/** 응답 없는 새 기여: 내 저장소 집합의 열린 이슈·PR 중 판정 규칙을 만족하는 것, 최근 갱신 순 */
export function listUnansweredContributions(
  db: DatabaseSync,
  options: UnansweredOptions & { limit?: number } = {}
): CountedList<ContributionItem> {
  const items: ContributionItem[] = [
    ...listIncomingPullRequestRecords(db)
      .filter((r) => isUnansweredContribution(facts(r), options))
      .map((r): ContributionItem => ({ kind: 'pull_request', item: strip(r) })),
    ...listIncomingIssueRecords(db)
      .filter((r) => isUnansweredContribution(facts(r), options))
      .map((r): ContributionItem => ({ kind: 'issue', item: strip(r) }))
  ].sort((a, b) =>
    a.item.updatedAt < b.item.updatedAt ? 1 : a.item.updatedAt > b.item.updatedAt ? -1 : 0
  )
  const limit = options.limit
  return {
    count: items.length,
    items: limit !== undefined && limit > 0 ? items.slice(0, limit) : items,
    // 들어온 항목을 다 받지 못한 저장소가 있으면 더 있을 수 있다
    complete: isIncomingPullRequestsComplete(db) && isIncomingIssuesComplete(db)
  }
}

export interface StarChangeOptions {
  now?: number
  /** 창 크기(일). 기본 7 */
  days?: number
  utcOffsetMinutes?: number
}

/** 스타 변화 카드: 상세 추적 저장소별 창 동안 늘어난 스타 수. 추적 순서 유지 */
export function getStarChanges(
  db: DatabaseSync,
  trackedRepoIds: readonly number[],
  options: StarChangeOptions = {}
): StarChangeItem[] {
  const days = options.days ?? STAR_HOME_WINDOW_DAYS
  return getRepositories(db, [...new Set(trackedRepoIds)]).map((repo) => {
    const growth = getStarGrowth(db, repo.id, { ...options, days })
    return {
      repoId: repo.id,
      repoFullName: repo.fullName,
      gained: growth.total,
      truncated: growth.truncated
    }
  })
}

export interface HomeSummaryOptions {
  now?: number
  /** 스타 변화 창(일). 기본 7 */
  starWindowDays?: number
  /** 응답 없는 새 기여에서 봇 제외. 기본 true */
  excludeBots?: boolean
  /** 카드별 목록 최대 개수. 기본 5 */
  limit?: number
  utcOffsetMinutes?: number
}

/**
 * Home 카드 다섯 종류의 데이터.
 * @param detailTrackedRepoIds 상세 추적 저장소 ID(고정 + 보고 있는 저장소). 실패한 CI (a)·스타 변화의 대상
 */
export function getHomeSummary(
  db: DatabaseSync,
  detailTrackedRepoIds: readonly number[],
  options: HomeSummaryOptions = {}
): HomeSummary {
  const limit = options.limit ?? 5
  const starWindowDays = options.starWindowDays ?? STAR_HOME_WINDOW_DAYS
  return {
    reviewRequests: (() => {
      const page = listReviewRequests(db, { limit })
      return { count: page.totalCount, items: page.items, complete: page.complete }
    })(),
    unreadNotifications: {
      count: countUnreadNotifications(db),
      items: listNotifications(db, { unreadOnly: true, limit }),
      complete: isNotificationListComplete(db)
    },
    failedCi: composeFailedCi(
      detailTrackedRepoIds,
      listTrackedRepoHeads(db, detailTrackedRepoIds),
      listMyPullRequests(db).items
    ),
    unansweredContributions: listUnansweredContributions(db, {
      excludeBots: options.excludeBots,
      limit
    }),
    starChanges: {
      windowDays: starWindowDays,
      items: getStarChanges(db, detailTrackedRepoIds, {
        now: options.now,
        days: starWindowDays,
        utcOffsetMinutes: options.utcOffsetMinutes
      })
    }
  }
}

/** 사이드바 수치 (spec §4.1) */
export function getSidebarCounts(db: DatabaseSync): SidebarCounts {
  return {
    unreadNotifications: countUnreadNotifications(db),
    incomingPullRequests: countIncomingPullRequests(db),
    reviewRequests: countReviewRequests(db)
  }
}
