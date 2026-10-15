import type { DatabaseSync } from 'node:sqlite'
import type { ConnectionStatus } from '@shared/domain/connection'
import { SEARCH_LIMIT, normalizeSearchText } from '@shared/domain/search'
import type { GitHubRepoHit, GitHubSearchResult, LocalSearchResult } from '@shared/domain/search'
import { searchLocal } from '../cache/search'
import { OfflineError, RateLimitedError } from '../github/client'
import type { GitHubClient } from '../github/client'

/** 빠른 검색창이 쓰는 클라이언트 기능만 (테스트에서 가짜로 바꾼다) */
export type SearchClient = Pick<GitHubClient, 'get' | 'getStatus'>

export interface SearchServiceDeps {
  db: () => DatabaseSync
  client: () => SearchClient
}

/** `GET /search/repositories` 의 items 한 줄 중 쓰는 필드 */
interface RawSearchRepository {
  id?: number | null
  name?: string | null
  full_name?: string | null
  owner?: { login?: string | null; avatar_url?: string | null } | null
  description?: string | null
  html_url?: string | null
  private?: boolean | null
  fork?: boolean | null
  archived?: boolean | null
  stargazers_count?: number | null
  language?: string | null
  pushed_at?: string | null
}

interface RawSearchResponse {
  total_count?: number | null
  incomplete_results?: boolean | null
  items?: (RawSearchRepository | null)[] | null
}

const EMPTY_LOCAL: LocalSearchResult = { repositories: [], pullRequests: [], issues: [] }

/** 검색 응답 한 줄 → 화면 행. 필수 값(ID·이름)이 없으면 null */
export function mapSearchRepository(raw: RawSearchRepository | null): GitHubRepoHit | null {
  if (!raw || typeof raw.id !== 'number' || !Number.isSafeInteger(raw.id) || raw.id <= 0) {
    return null
  }
  const fullName = raw.full_name ?? ''
  const slash = fullName.indexOf('/')
  const owner = raw.owner?.login || (slash > 0 ? fullName.slice(0, slash) : '')
  const name = raw.name || (slash > 0 ? fullName.slice(slash + 1) : '')
  if (!owner || !name) return null
  return {
    id: raw.id,
    owner,
    ownerAvatarUrl: raw.owner?.avatar_url ?? null,
    name,
    fullName: fullName || `${owner}/${name}`,
    description: raw.description ?? null,
    url: raw.html_url ?? '',
    private: raw.private === true,
    fork: raw.fork === true,
    archived: raw.archived === true,
    stargazerCount: typeof raw.stargazers_count === 'number' ? raw.stargazers_count : 0,
    primaryLanguage: raw.language ?? null,
    pushedAt: raw.pushed_at ?? null
  }
}

function refusal(status: ConnectionStatus): GitHubSearchResult | null {
  switch (status) {
    case 'online':
      return null
    case 'offline':
      return { status: 'offline' }
    case 'rate_limited':
      return { status: 'rate_limited' }
    default:
      return { status: 'error' }
  }
}

export interface SearchService {
  local(text: unknown): LocalSearchResult
  github(text: unknown, signal?: AbortSignal): Promise<GitHubSearchResult>
}

/**
 * 빠른 검색창(spec §4.12).
 * - local: 캐시에서 찾는다. 오프라인에서도 동작한다.
 * - github: online 일 때만 `GET /search/repositories` (검색 한도는 분당 30회로 따로 센다).
 *   실패해도 오류 문구는 돌려주지 않는다(토큰이 화면으로 새지 않게).
 */
export function createSearchService(deps: SearchServiceDeps): SearchService {
  return {
    local(text) {
      const query = normalizeSearchText(text)
      if (query === null) return EMPTY_LOCAL
      return searchLocal(deps.db(), query, { limit: SEARCH_LIMIT })
    },

    async github(text, signal) {
      const query = normalizeSearchText(text)
      if (query === null) return { status: 'ok', items: [] }
      const client = deps.client()
      const refused = refusal(client.getStatus())
      if (refused) return refused
      try {
        const res = await client.get<RawSearchResponse>('/search/repositories', {
          query: { q: query, per_page: SEARCH_LIMIT },
          signal
        })
        const items = (Array.isArray(res.data?.items) ? res.data.items : [])
          .map(mapSearchRepository)
          .filter((hit): hit is GitHubRepoHit => hit !== null)
          .slice(0, SEARCH_LIMIT)
        return { status: 'ok', items }
      } catch (error) {
        if (error instanceof OfflineError) return { status: 'offline' }
        if (error instanceof RateLimitedError) return { status: 'rate_limited' }
        return { status: 'error' }
      }
    }
  }
}
