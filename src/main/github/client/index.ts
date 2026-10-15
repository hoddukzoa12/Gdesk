import { createGitHubClient } from './client'
import type { GitHubClient, GitHubClientOptions } from './client'

// 공개 API. 단위 테스트용 주소 통로(testing.ts, TEST_BASE_URL)는 내보내지 않는다.
export {
  DEFAULT_REQUEST_TIMEOUT_MS,
  GITHUB_ACCEPT,
  GITHUB_API_VERSION,
  GitHubClient,
  USER_AGENT,
  createGitHubClient
} from './client'
export type {
  ConditionalRequestOptions,
  GitHubClientOptions,
  GraphQLRequestOptions,
  GraphQLResult,
  PaginateOptions,
  QueryValue,
  RestNotModified,
  RestRequestOptions,
  RestResponse,
  RestResponseMeta,
  RestResult,
  Scheduler,
  TokenProvider
} from './client'
export * from './errors'
export { parseLinkHeader } from './link'
export type { LinkRelations } from './link'
export { detectOrgRestriction } from './org-restriction'
export type { OrgRestriction, OrgRestrictionReason } from './org-restriction'
export { DEFAULT_LOW_RATE_LIMIT_RATIO, SECONDARY_DEFAULT_WAIT_MS } from './rate-limit'
export type { RateLimitInfo, RateLimitKind } from './rate-limit'

let instance: GitHubClient | null = null

/** 앱 시작 시 한 번 부른다. API 주소는 언제나 githubApiBase(). 두 번 부르면 구독이 끊기므로 오류를 낸다. */
export function configureGitHubClient(options: GitHubClientOptions): GitHubClient {
  if (instance) throw new Error('GitHub client is already configured')
  instance = createGitHubClient(options)
  return instance
}

export function getGitHubClient(): GitHubClient {
  if (!instance) throw new Error('GitHub client is not configured; call configureGitHubClient()')
  return instance
}

/** 테스트 전용: 싱글턴을 비운다. */
export function resetGitHubClientForTests(): void {
  instance?.dispose()
  instance = null
}
