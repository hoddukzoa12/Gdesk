import { GraphQLError, OrgAccessRestrictedError, getGitHubClient } from '../client'
import type { GitHubClient, OrgRestriction } from '../client'

/** 모든 수집기의 공통 옵션. client 를 주지 않으면 앱 공용 클라이언트를 쓴다(테스트는 주입) */
export interface CollectorOptions {
  client?: GitHubClient
  signal?: AbortSignal
}

export function resolveClient(options: CollectorOptions): GitHubClient {
  return options.client ?? getGitHubClient()
}

/** 목록 수집 결과 */
export interface ListResult<T> {
  items: T[]
  /** 모든 페이지를 받았는가(조직 제한으로 끊기거나 페이지 한도에 닿으면 false) */
  complete: boolean
  /** 수집 중 만난 조직 접근 제한(캐시에 기록할 것) */
  orgRestrictions: OrgRestriction[]
}

/**
 * 오류가 조직 접근 제한이면 그 정보를 돌려준다(수집은 계속). 아니면 null — 호출자가 다시 던진다.
 * - OrgAccessRestrictedError: REST 403·GraphQL 전체 실패
 * - GraphQLError 에 orgRestrictions 가 있으면 다른 오류와 섞여 있어도 조직 제한으로 본다
 */
export function orgRestrictionsFrom(error: unknown): OrgRestriction[] | null {
  if (error instanceof OrgAccessRestrictedError) {
    const r: OrgRestriction = { reason: error.reason, message: error.message }
    if (error.orgLogin) r.orgLogin = error.orgLogin
    return [r]
  }
  if (error instanceof GraphQLError && error.orgRestrictions.length > 0) {
    return [...error.orgRestrictions]
  }
  return null
}

/** owner/name → REST 경로 조각 */
export function repoPath(fullName: string): string {
  const [owner = '', name = ''] = fullName.split('/')
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
}
