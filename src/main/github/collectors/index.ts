/**
 * GitHub 수집기 (T7). collect* 는 받아서 변환만 하고, refresh* 는 받아서 캐시에 반영한다.
 * 모든 함수는 options.client 로 GitHub 클라이언트를 주입받는다(기본 getGitHubClient()).
 */
export { StaleRefreshError, orgRestrictionsFrom } from './common'
export type { CollectorOptions, ListResult } from './common'
export { SEARCH_COMMITS_PATH, collectContributions, collectRecentCommits } from './home-activity'
export type { ContributionsResult, RecentCommitsOptions } from './home-activity'
export { collectRepoOpenItems } from './items'
export type { RepoOpenItems, RepoOpenItemsOptions, RepoOpenItemsTarget } from './items'
export { NOTIFICATIONS_PATH, collectNotifications } from './notifications'
export type { NotificationsOptions, NotificationsResult } from './notifications'
export { LIST_LIMITS, OPERATIONS, RESPONSE_SAMPLE, REST_ENDPOINTS, SEARCH_QUERIES } from './queries'
export type { OperationName } from './queries'
export {
  SYNC_SCOPES,
  refreshContributions,
  refreshIssueLists,
  refreshMyRepositories,
  refreshNotifications,
  refreshPullRequestLists,
  refreshRecentCommits,
  refreshRepoOpenItems,
  refreshRepositoryDetails,
  refreshStarredRepositories,
  repoSyncScope
} from './refresh'
export type { MyRepositoriesRefreshOptions, RefreshContext } from './refresh'
export { collectContributors, collectRepositoryDetails, collectStargazers } from './repo-detail'
export type {
  RepoDetailOptions,
  RepoDetailOutcome,
  RepoDetailTarget,
  StargazerResult,
  UnavailableReason
} from './repo-detail'
export { collectMyRepositories, collectStarredRepositories } from './repositories'
export type { PagedOptions } from './repositories'
export {
  collectAssignedIssues,
  collectMyIssues,
  collectMyPullRequests,
  collectReviewRequests
} from './search'
export type { SearchOptions } from './search'
