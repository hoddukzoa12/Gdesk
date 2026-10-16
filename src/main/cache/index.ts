/**
 * GitHub 정보 캐시 (T7). 모든 함수는 첫 인자로 DB 연결을 받는다(앱에서는 getDb()).
 * 앱 시작 때 initCache() 를 한 번 불러 로그아웃·계정 변경 시 캐시가 비워지게 한다.
 */
export { CACHE_TABLES, clearCache, initCache } from './cleaner'
export {
  getHomeSummary,
  getSidebarCounts,
  getStarChanges,
  listUnansweredContributions
} from './home'
export type { HomeSummaryOptions, StarChangeOptions } from './home'
export {
  getContributions,
  listRecentCommits,
  replaceContributions,
  replaceRecentCommits
} from './home-activity'
export type { ContributionDayRecord, ContributionsRecord } from './home-activity'
export {
  ISSUE_DETAIL_CACHE_LIMIT,
  getIssueDetail,
  lookupRepoFullName,
  saveIssueDetail
} from './issue-details'
export {
  getIssueTabCounts,
  isIncomingIssuesComplete,
  listAssignedIssues,
  listIncomingIssues,
  listMentionedIssues,
  listMyIssues,
  listRepoIssues,
  replaceIssues,
  replaceRepoIssues
} from './issues'
export type { IssueScope } from './issues'
export {
  countUnreadNotifications,
  getNotification,
  isNotificationListComplete,
  listNotifications,
  markNotificationRead,
  mergeNotifications,
  removeNotification,
  replaceNotifications,
  restoreNotification
} from './notifications'
export {
  clearOrgRestrictions,
  listOrgRestrictions,
  recordOrgRestrictions
} from './org-restrictions'
export type { OrgRestrictionInput } from './org-restrictions'
export {
  countIncomingPullRequests,
  countReviewRequests,
  isIncomingPullRequestsComplete,
  listIncomingPullRequests,
  listMyPullRequests,
  listMyPullRequestsInRepo,
  listRepoPullRequests,
  listReviewRequests,
  replacePullRequests,
  replaceRepoPullRequests
} from './pull-requests'
export type { ListWriteOptions, PullRequestScope } from './pull-requests'
export {
  getRepositoryDetail,
  getStarGrowth,
  listStarTimestamps,
  listTrackedRepoHeads,
  saveRepositoryDetail
} from './repo-detail'
export type { RepositoryDetailReadOptions, StarWindowReadOptions } from './repo-detail'
export {
  getRepositories,
  getRepository,
  getRepositoryAccessStatuses,
  getRepositoryRefs,
  listAllRepositoryNames,
  listIssueRepoOptions,
  listMyRepositories,
  listMyRepositoryIds,
  listMyRepositoryOwners,
  listMyRepositoryRefs,
  listStarredRepositories,
  markRepositoryUnavailable,
  replaceMyRepositories,
  replaceStarredRepositories,
  restoreStarred,
  setRepositoryAccessStatus,
  setStarred,
  upsertRepositories
} from './repositories'
export type {
  RepoOwnerSummary,
  ReplaceMyRepositoriesOptions,
  RepositoryRef,
  StarSnapshot
} from './repositories'
export { searchLocal } from './search'
export { getSyncState, listSyncStates, updateSyncState } from './sync-state'
export type { SyncState, SyncStatePatch } from './sync-state'
export type * from './types'
