import type {
  CommitRecord,
  ContributorRecord,
  IssueRecord,
  LanguageRecord,
  PullRequestRecord,
  ReleaseRecord,
  RepositoryDetailRecord
} from '../../cache/types'
import { GitHubHttpError } from '../client'
import type { GitHubClient, OrgRestriction, RestResponse } from '../client'
import { orgRestrictionsFrom, repoPath, resolveClient } from './common'
import type { CollectorOptions } from './common'
import { compact, mapCommit, mapIssue, mapPullRequest, mapRelease, mapRepository } from './map'
import { OPERATIONS, REPOSITORY_DETAIL_QUERY } from './queries'
import type { RawContributor, RawRepositoryDetail, RawRestRepository, RawStargazer } from './raw'

/**
 * 저장소 상세 (spec §4.9). 비싼 수집이라 상세 추적 저장소(고정 + 보고 있는 저장소) ID 만 받는다.
 * 저장소마다: (노드 ID 가 없으면 REST /repositories/{id}) → GraphQL 상세 1회 → REST 기여자 1~2회 → REST 스타 시각 2회 이상.
 */
export interface RepoDetailTarget {
  /** GitHub 숫자 저장소 ID */
  repoId: number
  /** 캐시에 있으면 GraphQL 노드 ID. 없으면 REST 로 찾는다(로그아웃 뒤 고정만 남은 경우 등) */
  nodeId?: string | null
}

export type UnavailableReason = 'not_found' | 'forbidden' | 'org_restricted'

export type RepoDetailOutcome =
  | { repoId: number; status: 'ok'; detail: RepositoryDetailRecord }
  | { repoId: number; status: 'unavailable'; reason: UnavailableReason }

export interface RepoDetailOptions extends CollectorOptions {
  now?: number
  /** 스타 시각을 받을 기간(일). 기본 30 */
  starDays?: number
  /** 열린 PR·이슈 수. 기본 30 */
  itemCount?: number
  /** 기본 브랜치 최근 커밋 수. 기본 7 */
  commitCount?: number
  /** 릴리스 수. 기본 20 */
  releaseCount?: number
  /** 기여자 아바타 수. 기본 20 */
  contributorCount?: number
  /** 스타 시각 최대 요청 수. 기본 20 */
  maxStargazerPages?: number
}

const DAY_MS = 86_400_000

interface DetailData {
  viewer?: { login?: string | null } | null
  node?: RawRepositoryDetail | null
}

class Unavailable extends Error {
  constructor(readonly reason: UnavailableReason) {
    super(reason)
  }
}

function unavailableFromHttp(error: unknown): Unavailable | null {
  if (!(error instanceof GitHubHttpError)) return null
  if (error.status === 404 || error.status === 410) return new Unavailable('not_found')
  if (error.status === 403 || error.status === 451) return new Unavailable('forbidden')
  return null
}

async function resolveNodeId(
  client: GitHubClient,
  repoId: number,
  signal?: AbortSignal
): Promise<string> {
  try {
    const res = await client.get<RawRestRepository>(`/repositories/${repoId}`, { signal })
    const nodeId = res.data?.node_id
    if (!nodeId) throw new Unavailable('not_found')
    return nodeId
  } catch (error) {
    throw unavailableFromHttp(error) ?? error
  }
}

export async function collectRepositoryDetails(
  targets: readonly RepoDetailTarget[],
  options: RepoDetailOptions = {}
): Promise<{ results: RepoDetailOutcome[]; orgRestrictions: OrgRestriction[] }> {
  const client = resolveClient(options)
  const results: RepoDetailOutcome[] = []
  const orgRestrictions: OrgRestriction[] = []
  for (const target of targets) {
    try {
      results.push(await collectOne(client, target, options, orgRestrictions))
    } catch (error) {
      if (error instanceof Unavailable) {
        results.push({ repoId: target.repoId, status: 'unavailable', reason: error.reason })
        continue
      }
      const restrictions = orgRestrictionsFrom(error)
      if (!restrictions) throw error
      orgRestrictions.push(...restrictions)
      results.push({ repoId: target.repoId, status: 'unavailable', reason: 'org_restricted' })
    }
  }
  return { results, orgRestrictions }
}

async function collectOne(
  client: GitHubClient,
  target: RepoDetailTarget,
  options: RepoDetailOptions,
  orgRestrictions: OrgRestriction[]
): Promise<RepoDetailOutcome> {
  const nodeId = target.nodeId || (await resolveNodeId(client, target.repoId, options.signal))
  const res = await client.graphql<DetailData>(
    REPOSITORY_DETAIL_QUERY,
    {
      id: nodeId,
      itemCount: options.itemCount ?? 30,
      commitCount: options.commitCount ?? 7,
      releaseCount: options.releaseCount ?? 20
    },
    { operationName: OPERATIONS.repositoryDetail, signal: options.signal }
  )
  orgRestrictions.push(...res.orgRestrictions)
  const node = res.data.node
  const repository = mapRepository(node)
  if (!node || !repository) {
    // 삭제·권한 상실이면 node 가 null (NOT_FOUND 오류와 함께)
    if (res.orgRestrictions.length > 0) throw new Unavailable('org_restricted')
    throw new Unavailable('not_found')
  }
  const viewer = res.data.viewer?.login ?? null
  const now = options.now ?? Date.now()

  const languages: LanguageRecord[] = compact(node.languages?.edges)
    .filter((e) => typeof e.node?.name === 'string')
    .map((e) => ({
      name: e.node?.name as string,
      color: e.node?.color ?? null,
      bytes: e.size ?? 0
    }))

  const contributors = await collectContributors(client, repository.fullName, {
    perPage: options.contributorCount ?? 20,
    signal: options.signal
  })
  const stars = await collectStargazers(client, repository.fullName, {
    now,
    days: options.starDays ?? 30,
    maxPages: options.maxStargazerPages ?? 20,
    signal: options.signal
  })

  const detail: RepositoryDetailRecord = {
    repository,
    openPullRequests: compact(node.openPullRequests?.nodes)
      .map((p) => mapPullRequest(p, viewer))
      .filter((p): p is PullRequestRecord => p !== null),
    openIssues: compact(node.openIssues?.nodes)
      .map((i) => mapIssue(i, viewer))
      .filter((i): i is IssueRecord => i !== null),
    commits: compact(node.defaultBranchRef?.target?.history?.nodes)
      .map(mapCommit)
      .filter((c): c is CommitRecord => c !== null),
    latestRelease: mapRelease(node.latestRelease),
    releaseCount: node.releases?.totalCount ?? 0,
    releases: compact(node.releases?.nodes)
      .map(mapRelease)
      .filter((r): r is ReleaseRecord => r !== null),
    languages,
    contributors: contributors.contributors,
    contributorCount: contributors.total,
    stargazers: stars.stargazers,
    starsSince: stars.since,
    starsTruncated: stars.truncated
  }
  return { repoId: target.repoId, status: 'ok', detail }
}

function pageOf(url: string | undefined): number | null {
  if (!url) return null
  try {
    const n = Number(new URL(url).searchParams.get('page'))
    return Number.isSafeInteger(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/**
 * 기여자 아바타와 총 인원. `GET /repos/{o}/{r}/contributors?per_page=N&anon=false`.
 * Link 의 last 가 있으면 마지막 페이지를 한 번 더 받아 총 인원 = (last-1)*N + 마지막 페이지 수.
 * 빈 저장소(204)는 0명. 너무 큰 저장소(403) 등은 빈 목록과 total null.
 */
export async function collectContributors(
  client: GitHubClient,
  fullName: string,
  options: { perPage?: number; signal?: AbortSignal } = {}
): Promise<{ contributors: ContributorRecord[]; total: number | null }> {
  const perPage = Math.min(100, Math.max(1, options.perPage ?? 20))
  const path = `${repoPath(fullName)}/contributors`
  try {
    const first = await client.get<RawContributor[] | null>(path, {
      query: { per_page: perPage, anon: 'false' },
      signal: options.signal
    })
    const list = Array.isArray(first.data) ? first.data : []
    const contributors = list
      .filter((c) => typeof c.login === 'string' && c.type !== 'Anonymous')
      .map((c) => ({
        login: c.login as string,
        avatarUrl: c.avatar_url ?? null,
        url: c.html_url ?? null,
        contributions: c.contributions ?? 0
      }))
    const lastPage = pageOf(first.links.last)
    if (lastPage === null || lastPage <= 1) return { contributors, total: list.length }
    const last = await client.get<RawContributor[] | null>(first.links.last as string, {
      signal: options.signal
    })
    const lastCount = Array.isArray(last.data) ? last.data.length : 0
    return { contributors, total: (lastPage - 1) * perPage + lastCount }
  } catch (error) {
    if (error instanceof GitHubHttpError) return { contributors: [], total: null }
    throw error
  }
}

export interface StargazerResult {
  stargazers: { starredAt: string; login: string | null }[]
  /** 이 시각(ISO) 이후의 스타만 담았다 */
  since: string
  /** 기간 전체를 다 받지 못했다 */
  truncated: boolean
}

/**
 * 최근 스타 시각. `GET /repos/{o}/{r}/stargazers` (Accept: application/vnd.github.star+json).
 * 첫 페이지의 Link 에서 last 를 얻어 마지막 페이지부터 prev 로 거꾸로 걷는다.
 * 페이지 안은 오래된 → 최신 순이므로 페이지의 첫 항목이 기준 시각보다 오래되면 멈춘다.
 * 기준 시각은 days+1 일 전(시간대에 따른 날짜 경계 여유). 페이지 한도·깊은 페이지 거부(422)면 truncated.
 */
export async function collectStargazers(
  client: GitHubClient,
  fullName: string,
  options: { now?: number; days?: number; maxPages?: number; signal?: AbortSignal } = {}
): Promise<StargazerResult> {
  const now = options.now ?? Date.now()
  const cutoff = now - ((options.days ?? 30) + 1) * DAY_MS
  const since = new Date(cutoff).toISOString()
  const maxPages = Math.max(1, options.maxPages ?? 20)
  const request = {
    headers: { Accept: 'application/vnd.github.star+json' },
    signal: options.signal
  }
  const out: StargazerResult['stargazers'] = []

  const keep = (items: unknown): number | null => {
    // 페이지의 첫(가장 오래된) 시각을 돌려준다
    const list = Array.isArray(items) ? (items as RawStargazer[]) : []
    let oldest: number | null = null
    for (const s of list) {
      const at = s.starred_at ? Date.parse(s.starred_at) : NaN
      if (!Number.isFinite(at)) continue
      if (oldest === null || at < oldest) oldest = at
      if (at >= cutoff)
        out.push({ starredAt: s.starred_at as string, login: s.user?.login ?? null })
    }
    return oldest
  }

  try {
    const first = await client.get<RawStargazer[]>(`${repoPath(fullName)}/stargazers`, {
      ...request,
      query: { per_page: 100 }
    })
    let url = first.links.last
    if (!url || pageOf(url) === 1) {
      keep(first.data)
      return { stargazers: out, since, truncated: false }
    }
    let pages = 1
    while (url) {
      if (pageOf(url) === 1) {
        // 이미 받은 첫 페이지
        keep(first.data)
        return { stargazers: out, since, truncated: false }
      }
      if (pages >= maxPages) return { stargazers: out, since, truncated: true }
      const page: RestResponse<RawStargazer[]> = await client.get<RawStargazer[]>(url, request)
      pages++
      const oldest = keep(page.data)
      if (oldest !== null && oldest < cutoff) return { stargazers: out, since, truncated: false }
      url = page.links.prev
    }
    return { stargazers: out, since, truncated: false }
  } catch (error) {
    if (error instanceof GitHubHttpError && error.status === 422) {
      return { stargazers: out, since, truncated: true }
    }
    throw error
  }
}
