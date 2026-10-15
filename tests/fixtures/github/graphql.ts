import { OPERATIONS } from '../../../src/main/github/collectors/queries'
import type {
  RawCommit,
  RawIssue,
  RawPullRequest,
  RawRelease,
  RawRepository,
  RawRepositoryDetail,
  RawResponses
} from '../../../src/main/github/collectors/raw'
import { avatarUrl, fullName } from './data'
import type {
  FixtureActor,
  FixtureCommit,
  FixtureItem,
  FixtureRelease,
  FixtureRepo,
  FixtureResponse,
  FixtureState
} from './data'

/**
 * GraphQL 응답 만들기. operationName 으로 고른다(queries.ts 의 OPERATIONS).
 * 응답 모양은 앱의 raw.ts 타입을 따른다. 변수(pageSize·cursor·itemCount·responseCount 등)를 존중한다.
 */

export interface GraphQLContext {
  state: FixtureState
  webBase: string
}

export interface GraphQLBody {
  data?: unknown
  errors?: { type?: string; message: string; path?: (string | number)[] }[]
}

type Vars = Record<string, unknown>

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

export function encodeCursor(offset: number): string {
  return Buffer.from(`cursor:${offset}`).toString('base64')
}

function decodeCursor(cursor: unknown): number {
  if (typeof cursor !== 'string' || cursor === '') return 0
  const m = /^cursor:(\d+)$/.exec(Buffer.from(cursor, 'base64').toString('utf8'))
  return m ? Number(m[1]) : 0
}

function page<T>(list: T[], vars: Vars) {
  const size = num(vars.pageSize, 100)
  const start = decodeCursor(vars.cursor)
  const nodes = list.slice(start, start + size)
  const end = start + nodes.length
  return {
    nodes,
    pageInfo: {
      hasNextPage: end < list.length,
      endCursor: nodes.length > 0 ? encodeCursor(end) : null
    }
  }
}

function actorOf(state: FixtureState, login: string): FixtureActor {
  return state.actors.find((a) => a.login === login) ?? { id: 0, login, name: null, type: 'User' }
}

function rawActor(state: FixtureState, login: string) {
  const actor = actorOf(state, login)
  return { __typename: actor.type, login: actor.login, avatarUrl: avatarUrl(actor.login) }
}

export function repoItems(state: FixtureState, repoId: number, kind: FixtureItem['kind']) {
  return state.items
    .filter((i) => i.repoId === repoId && i.kind === kind)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function renderRepository(ctx: GraphQLContext, repo: FixtureRepo): RawRepository {
  const name = fullName(repo)
  return {
    id: repo.nodeId,
    databaseId: repo.id,
    name: repo.name,
    nameWithOwner: name,
    url: `${ctx.webBase}/${name}`,
    isPrivate: repo.isPrivate,
    isFork: repo.isFork,
    isArchived: repo.isArchived,
    description: repo.description,
    homepageUrl: repo.homepageUrl ?? '',
    owner: rawActor(ctx.state, repo.owner),
    primaryLanguage: repo.primaryLanguage ? { ...repo.primaryLanguage } : null,
    defaultBranchRef: { name: repo.defaultBranch },
    licenseInfo: repo.license ? { ...repo.license } : null,
    stargazerCount: repo.stargazers.length,
    forkCount: repo.forkCount,
    pullRequests: { totalCount: repoItems(ctx.state, repo.id, 'PullRequest').length },
    issues: { totalCount: repoItems(ctx.state, repo.id, 'Issue').length },
    pushedAt: repo.pushedAt,
    updatedAt: repo.updatedAt,
    repositoryTopics: { nodes: repo.topics.map((name) => ({ topic: { name } })) },
    viewerPermission: repo.viewerPermission,
    viewerHasStarred: repo.viewerStarredAt !== null
  }
}

function responses(list: FixtureResponse[], last: number): RawResponses {
  const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return {
    totalCount: sorted.length,
    nodes: sorted.slice(-last).map((r) => ({ authorAssociation: r.authorAssociation }))
  }
}

function itemUrl(ctx: GraphQLContext, repo: FixtureRepo, item: FixtureItem): string {
  return `${ctx.webBase}/${fullName(repo)}/${item.kind === 'PullRequest' ? 'pull' : 'issues'}/${item.number}`
}

function repoById(state: FixtureState, id: number): FixtureRepo {
  const repo = state.repos.find((r) => r.id === id)
  if (!repo) throw new Error(`fixture item points at missing repo ${id}`)
  return repo
}

export function renderPullRequest(
  ctx: GraphQLContext,
  item: FixtureItem,
  responseCount: number
): RawPullRequest {
  const repo = repoById(ctx.state, item.repoId)
  return {
    __typename: 'PullRequest',
    id: item.nodeId,
    number: item.number,
    title: item.title,
    url: itemUrl(ctx, repo, item),
    isDraft: item.isDraft,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    reviewDecision: item.reviewDecision,
    authorAssociation: item.authorAssociation,
    author: rawActor(ctx.state, item.author),
    repository: { databaseId: repo.id, nameWithOwner: fullName(repo) },
    comments: responses(item.comments, responseCount),
    reviews: responses(item.reviews, responseCount),
    commits: {
      nodes: [
        { commit: { statusCheckRollup: item.ciState === null ? null : { state: item.ciState } } }
      ]
    }
  }
}

export function renderIssue(
  ctx: GraphQLContext,
  item: FixtureItem,
  responseCount: number
): RawIssue {
  const repo = repoById(ctx.state, item.repoId)
  return {
    __typename: 'Issue',
    id: item.nodeId,
    number: item.number,
    title: item.title,
    url: itemUrl(ctx, repo, item),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    authorAssociation: item.authorAssociation,
    author: rawActor(ctx.state, item.author),
    repository: { databaseId: repo.id, nameWithOwner: fullName(repo) },
    labels: { nodes: item.labels.slice(0, 10).map((l) => ({ ...l })) },
    comments: responses(item.comments, responseCount)
  }
}

function renderItem(ctx: GraphQLContext, item: FixtureItem, responseCount: number) {
  return item.kind === 'PullRequest'
    ? renderPullRequest(ctx, item, responseCount)
    : renderIssue(ctx, item, responseCount)
}

function renderRelease(ctx: GraphQLContext, repo: FixtureRepo, r: FixtureRelease): RawRelease {
  return {
    id: r.nodeId,
    tagName: r.tagName,
    name: r.name,
    publishedAt: r.publishedAt,
    createdAt: r.createdAt,
    isPrerelease: r.isPrerelease,
    isDraft: r.isDraft,
    isLatest: r === latestRelease(repo),
    url: `${ctx.webBase}/${fullName(repo)}/releases/tag/${r.tagName}`
  }
}

/** GitHub 의 latest: 초안·프리릴리스가 아닌 것 중 가장 최근 */
export function latestRelease(repo: FixtureRepo): FixtureRelease | null {
  return (
    [...repo.releases]
      .filter((r) => !r.isDraft && !r.isPrerelease)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  )
}

function renderCommit(ctx: GraphQLContext, repo: FixtureRepo, c: FixtureCommit): RawCommit {
  const user = actorOf(ctx.state, c.author)
  return {
    oid: c.oid,
    abbreviatedOid: c.oid.slice(0, 7),
    messageHeadline: c.message,
    committedDate: c.committedDate,
    url: `${ctx.webBase}/${fullName(repo)}/commit/${c.oid}`,
    author: { name: user.name ?? user.login, user: rawActor(ctx.state, c.author) },
    statusCheckRollup: c.ciState === null ? null : { state: c.ciState }
  }
}

function openItemsConnection(
  ctx: GraphQLContext,
  repo: FixtureRepo,
  kind: FixtureItem['kind'],
  itemCount: number,
  responseCount: number
) {
  const all = repoItems(ctx.state, repo.id, kind)
  return {
    totalCount: all.length,
    nodes: all.slice(0, itemCount).map((i) => renderItem(ctx, i, responseCount))
  }
}

function notFound(path: (string | number)[], id: unknown) {
  return {
    type: 'NOT_FOUND',
    path,
    message: `Could not resolve to a node with the global id of '${String(id)}'.`
  }
}

function viewerOf(ctx: GraphQLContext) {
  return { login: ctx.state.viewer.login }
}

function searchItems(ctx: GraphQLContext, operationName: string): FixtureItem[] {
  const v = ctx.state.viewer.login
  const teams = ctx.state.viewerTeams
  const pick = (kind: FixtureItem['kind'], match: (i: FixtureItem) => boolean) =>
    ctx.state.items
      .filter((i) => i.kind === kind && match(i))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  switch (operationName) {
    case OPERATIONS.myPullRequests:
      return pick('PullRequest', (i) => i.author === v)
    case OPERATIONS.reviewRequests:
      return pick('PullRequest', (i) => i.reviewRequests.some((r) => r === v || teams.includes(r)))
    case OPERATIONS.assignedIssues:
      return pick('Issue', (i) => i.assignees.includes(v))
    case OPERATIONS.myIssues:
      return pick('Issue', (i) => i.author === v)
    default:
      return []
  }
}

const SEARCH_OPERATIONS: readonly string[] = [
  OPERATIONS.myPullRequests,
  OPERATIONS.reviewRequests,
  OPERATIONS.assignedIssues,
  OPERATIONS.myIssues
]

/** operationName 에 맞는 응답. 모르는 이름이면 null (서버가 오류로 답한다) */
export function handleGraphQL(
  ctx: GraphQLContext,
  operationName: string,
  vars: Vars
): GraphQLBody | null {
  const responseCount = num(vars.responseCount, 50)
  const itemCount = num(vars.itemCount, 50)

  if (operationName === OPERATIONS.myRepositories) {
    const list = ctx.state.repos
      .filter((r) => r.viewerAffiliated)
      .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))
    const { nodes, pageInfo } = page(list, vars)
    return {
      data: {
        viewer: {
          login: ctx.state.viewer.login,
          repositories: { pageInfo, nodes: nodes.map((r) => renderRepository(ctx, r)) }
        }
      }
    }
  }

  if (operationName === OPERATIONS.starredRepositories) {
    const list = ctx.state.repos
      .filter((r) => r.viewerStarredAt !== null)
      .sort((a, b) => (b.viewerStarredAt ?? '').localeCompare(a.viewerStarredAt ?? ''))
    const { nodes, pageInfo } = page(list, vars)
    return {
      data: {
        viewer: {
          starredRepositories: {
            pageInfo,
            edges: nodes.map((r) => ({
              starredAt: r.viewerStarredAt,
              node: renderRepository(ctx, r)
            }))
          }
        }
      }
    }
  }

  if (operationName === OPERATIONS.repoOpenItems) {
    const ids = Array.isArray(vars.ids) ? vars.ids : []
    const errors: NonNullable<GraphQLBody['errors']> = []
    // nodes 는 ids 와 같은 순서·길이여야 한다(수집기가 위치로 맞춘다)
    const nodes = ids.map((id, index) => {
      const repo = ctx.state.repos.find((r) => r.nodeId === id)
      if (!repo) {
        errors.push(notFound(['nodes', index], id))
        return null
      }
      return {
        databaseId: repo.id,
        openPullRequests: openItemsConnection(ctx, repo, 'PullRequest', itemCount, responseCount),
        openIssues: openItemsConnection(ctx, repo, 'Issue', itemCount, responseCount)
      }
    })
    return errors.length > 0
      ? { data: { viewer: viewerOf(ctx), nodes }, errors }
      : { data: { viewer: viewerOf(ctx), nodes } }
  }

  if (SEARCH_OPERATIONS.includes(operationName)) {
    const list = searchItems(ctx, operationName)
    const { nodes, pageInfo } = page(list, vars)
    return {
      data: {
        viewer: viewerOf(ctx),
        search: {
          issueCount: list.length,
          pageInfo,
          nodes: nodes.map((i) => renderItem(ctx, i, responseCount))
        }
      }
    }
  }

  if (operationName === OPERATIONS.repositoryDetail) {
    const repo = ctx.state.repos.find((r) => r.nodeId === vars.id)
    if (!repo) {
      return { data: { viewer: viewerOf(ctx), node: null }, errors: [notFound(['node'], vars.id)] }
    }
    const commitCount = num(vars.commitCount, 7)
    const releaseCount = num(vars.releaseCount, 20)
    const releases = [...repo.releases].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const latest = latestRelease(repo)
    const languages = [...repo.languages].sort((a, b) => b.size - a.size)
    const node: RawRepositoryDetail = {
      ...renderRepository(ctx, repo),
      openPullRequests: openItemsConnection(ctx, repo, 'PullRequest', itemCount, responseCount),
      openIssues: openItemsConnection(ctx, repo, 'Issue', itemCount, responseCount),
      defaultBranchRef: {
        name: repo.defaultBranch,
        target: {
          history: {
            nodes: repo.commits.slice(0, commitCount).map((c) => renderCommit(ctx, repo, c))
          }
        }
      },
      latestRelease: latest ? renderRelease(ctx, repo, latest) : null,
      releases: {
        totalCount: releases.length,
        nodes: releases.slice(0, releaseCount).map((r) => renderRelease(ctx, repo, r))
      },
      languages: {
        totalSize: languages.reduce((n, l) => n + l.size, 0),
        edges: languages
          .slice(0, 20)
          .map((l) => ({ size: l.size, node: { name: l.name, color: l.color } }))
      }
    }
    return { data: { viewer: viewerOf(ctx), node } }
  }

  return null
}
