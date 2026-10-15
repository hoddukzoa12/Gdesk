import type { IssueRow } from './issue'
import type { PullRequestRow } from './pr'
import type { RepositorySummary } from './repo'

/** 빠른 검색창의 앱 안 항목 결과 (spec §4.12). 저장된 정보만 쓰므로 오프라인에서도 동작한다 */
export interface LocalSearchResult {
  repositories: RepositorySummary[]
  pullRequests: PullRequestRow[]
  issues: IssueRow[]
}

/** 검색어 최소 길이(앞뒤 공백 제외). 이보다 짧으면 빈 결과 */
export const SEARCH_MIN_LENGTH = 2
/** 구역마다 돌려주는 최대 개수 */
export const SEARCH_LIMIT = 10
/** GitHub 검색어 최대 길이(GitHub 의 q 상한) */
export const SEARCH_MAX_LENGTH = 256

/** GitHub 전체 저장소 검색(`GET /search/repositories`) 결과 한 줄 */
export interface GitHubRepoHit {
  /** GitHub 숫자 저장소 ID. 앱 안 상세 화면 `/repos/<id>` 로 연다 */
  id: number
  owner: string
  ownerAvatarUrl: string | null
  name: string
  /** `owner/name` */
  fullName: string
  description: string | null
  /** GitHub 웹 주소 */
  url: string
  private: boolean
  fork: boolean
  archived: boolean
  stargazerCount: number
  primaryLanguage: string | null
  /** ISO 8601 */
  pushedAt: string | null
}

/**
 * GitHub 저장소 검색 응답. online 이 아니면 요청하지 않고 거절한다.
 * 오류 문구는 담지 않는다(토큰·내부 정보가 화면으로 새지 않게).
 */
export type GitHubSearchResult =
  { status: 'ok'; items: GitHubRepoHit[] } | { status: 'offline' | 'rate_limited' | 'error' }

/** 앞뒤 공백을 뺀 검색어. 최소 길이에 못 미치면 null */
export function normalizeSearchText(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim().slice(0, SEARCH_MAX_LENGTH).trim()
  return trimmed.length >= SEARCH_MIN_LENGTH ? trimmed : null
}
