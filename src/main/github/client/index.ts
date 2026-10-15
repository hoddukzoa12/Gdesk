import { githubApiBase } from '../../config'
import { GitHubClient } from './client'
import type { GitHubClientOptions } from './client'

export * from './client'
export * from './errors'
export { parseLinkHeader } from './link'
export type { LinkRelations } from './link'
export { detectOrgRestriction } from './org-restriction'
export type { OrgRestriction, OrgRestrictionReason } from './org-restriction'
export { DEFAULT_LOW_RATE_LIMIT_RATIO, SECONDARY_DEFAULT_WAIT_MS } from './rate-limit'
export type { RateLimitInfo, RateLimitKind } from './rate-limit'

/** 배포 경로의 설정. API 주소는 언제나 githubApiBase() (테스트 모드에서만 바뀜). */
export type ConfigureGitHubClientOptions = Omit<GitHubClientOptions, 'baseUrl'>

let instance: GitHubClient | null = null

/** 앱 시작 시 한 번 부른다. 두 번 부르면 구독이 끊기므로 오류를 낸다. */
export function configureGitHubClient(options: ConfigureGitHubClientOptions): GitHubClient {
  if (instance) throw new Error('GitHub client is already configured')
  instance = new GitHubClient({ ...options, baseUrl: githubApiBase() })
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
