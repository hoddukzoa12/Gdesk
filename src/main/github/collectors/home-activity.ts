import type { RecentCommit } from '@shared/domain/home-activity'
import type { ContributionsRecord } from '../../cache/home-activity'
import { GraphQLError } from '../client'
import { resolveClient } from './common'
import type { CollectorOptions } from './common'
import { mapCommitSearchItem, mapContributions } from './map'
import { CONTRIBUTIONS_QUERY, LIST_LIMITS, OPERATIONS } from './queries'
import type { RawCommitSearchItem, RawContributionsViewer } from './raw'

/** Home 활동 영역 수집 (spec 5.4·5.5). 받아서 바꾸기만 한다. 캐시 반영은 refresh.ts */

export interface ContributionsResult extends ContributionsRecord {
  login: string | null
}

/** 내 기여 달력(최근 12개월)과 커밋 기여 수. GraphQL 한도(graphql)를 쓴다 */
export async function collectContributions(
  options: CollectorOptions = {}
): Promise<ContributionsResult> {
  const client = resolveClient(options)
  const res = await client.graphql<{ viewer?: RawContributionsViewer | null }>(
    CONTRIBUTIONS_QUERY,
    {},
    { operationName: OPERATIONS.contributions, signal: options.signal }
  )
  const mapped = mapContributions(res.data.viewer)
  if (mapped === null) {
    // 부분 응답으로 달력이 비어 왔으면 기존 캐시를 지우지 않도록 실패로 본다
    throw new GraphQLError(
      res.errors.length > 0 ? res.errors : [{ message: 'Missing contributionsCollection' }],
      res.orgRestrictions
    )
  }
  return { login: res.data.viewer?.login ?? null, ...mapped }
}

export interface RecentCommitsOptions extends CollectorOptions {
  /** 내 GitHub 로그인 이름 */
  login: string
  /** 기본 5 */
  limit?: number
}

export const SEARCH_COMMITS_PATH = '/search/commits'

/**
 * 내 최근 커밋: 커밋 검색 `author:<login>`, 작성 시각 최신 순. 검색 한도(search)를 쓴다.
 * 검색은 기본 브랜치만 보고 몇 분 늦을 수 있다(받아들인 한계).
 */
export async function collectRecentCommits(options: RecentCommitsOptions): Promise<RecentCommit[]> {
  const client = resolveClient(options)
  const res = await client.get<{ items?: (RawCommitSearchItem | null)[] | null } | null>(
    SEARCH_COMMITS_PATH,
    {
      query: {
        q: `author:${options.login}`,
        sort: 'author-date',
        order: 'desc',
        per_page: options.limit ?? LIST_LIMITS.recentCommits
      },
      signal: options.signal
    }
  )
  const items = Array.isArray(res.data?.items) ? res.data.items : []
  return items.map(mapCommitSearchItem).filter((c): c is RecentCommit => c !== null)
}
