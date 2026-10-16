import { OPERATIONS } from '../../../src/main/github/collectors/queries'
import type {
  RawCommit,
  RawContributionsViewer,
  RawIssue,
  RawIssueComment,
  RawIssueDetailRepository,
  RawIssueTimelineItem,
  RawLinkedPullRequest,
  RawPullRequest,
  RawReactionGroup,
  RawRelease,
  RawRepository,
  RawRepositoryDetail,
  RawResponses
} from '../../../src/main/github/collectors/raw'
import { REACTION_CONTENTS, avatarUrl, commentNodeId, fullName } from './data'
import type {
  FixtureActor,
  FixtureCommit,
  FixtureItem,
  FixtureLinkedPullRequest,
  FixtureReactions,
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
  /** 지금 시각(ms). 기본 Date.now */
  now?: () => number
  /**
   * 앱에서 만든 이슈가 검색에 나오기까지의 지연(ms). null 이면 `indexCreatedIssues()` 를 부를 때까지 나오지 않는다.
   * 기본 null
   */
  searchIndexDelayMs?: number | null
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

/** 열린 항목인가(state 가 없으면 열림) */
export function isOpen(item: FixtureItem): boolean {
  return (item.state ?? 'OPEN') === 'OPEN'
}

/** 저장소의 열린 PR·이슈(갱신 최신순). 닫힌 이슈는 빠진다(열린 수·목록·상세 공통) */
export function repoItems(state: FixtureState, repoId: number, kind: FixtureItem['kind']) {
  return state.items
    .filter((i) => i.repoId === repoId && i.kind === kind && isOpen(i))
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
    viewerHasStarred: repo.viewerStarredAt !== null,
    hasIssuesEnabled: repo.hasIssuesEnabled
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
    assignees: { nodes: item.assignees.slice(0, 10).map((a) => rawActor(ctx.state, a)) },
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

/**
 * 검색 반영 지연 흉내: 앱에서 POST 로 만든 이슈는 indexCreatedIssues() 를 부르거나
 * searchIndexDelayMs 가 지나기 전까지 검색에 나오지 않는다(저장소 연결 목록에는 바로 나온다)
 */
function isSearchable(ctx: GraphQLContext, item: FixtureItem): boolean {
  if (item.createdInAppAt === undefined || item.searchIndexed === true) return true
  const delay = ctx.searchIndexDelayMs ?? null
  return delay !== null && nowOf(ctx) - item.createdInAppAt >= delay
}

function nowOf(ctx: GraphQLContext): number {
  return ctx.now ? ctx.now() : Date.now()
}

function searchItems(ctx: GraphQLContext, operationName: string): FixtureItem[] {
  const v = ctx.state.viewer.login
  const teams = ctx.state.viewerTeams
  // 검색은 언제나 is:open
  const pick = (kind: FixtureItem['kind'], match: (i: FixtureItem) => boolean) =>
    ctx.state.items
      .filter((i) => i.kind === kind && isOpen(i) && isSearchable(ctx, i) && match(i))
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
    case OPERATIONS.mentionedIssues:
      return pick('Issue', (i) => (i.mentions ?? []).includes(v))
    default:
      return []
  }
}

const SEARCH_OPERATIONS: readonly string[] = [
  OPERATIONS.myPullRequests,
  OPERATIONS.reviewRequests,
  OPERATIONS.assignedIssues,
  OPERATIONS.myIssues,
  OPERATIONS.mentionedIssues
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

  if (operationName === OPERATIONS.contributions) {
    const c = ctx.state.contributions
    const viewer: RawContributionsViewer = {
      login: ctx.state.viewer.login,
      contributionsCollection: {
        totalCommitContributions: c.totalCommitContributions,
        contributionCalendar: {
          weeks: c.weeks.map((w) => ({
            contributionDays: w.contributionDays.map((d) => ({ ...d }))
          }))
        }
      }
    }
    return { data: { viewer } }
  }

  if (operationName === OPERATIONS.issueDetail) return issueDetail(ctx, vars)

  const mutation = MUTATIONS[operationName]
  if (mutation) return mutation(ctx, vars)

  return null
}

// ───────────────────────── 이슈 상세 ─────────────────────────

const WRITE_PERMISSIONS: readonly string[] = ['ADMIN', 'MAINTAIN', 'WRITE']

/** HTML 특수 문자 이스케이프 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 아주 간단한 마크다운 → HTML: 이스케이프한 뒤 빈 줄로 문단을 나누고, 줄바꿈은 <br>, `**굵게**` 는 <strong>.
 * 코멘트 bodyHTML 과 POST /markdown 이 쓴다.
 */
export function renderMarkdownLite(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map(
      (p) =>
        `<p>${escapeHtml(p)
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>')}</p>`
    )
    .join('\n')
}

function findRepoByName(state: FixtureState, owner: unknown, name: unknown): FixtureRepo | null {
  if (typeof owner !== 'string' || typeof name !== 'string') return null
  const key = `${owner}/${name}`.toLowerCase()
  return (
    state.repos.find((r) => fullName(r).toLowerCase() === key) ??
    state.repos.find((r) => r.previousNames.some((n) => n.toLowerCase() === key)) ??
    null
  )
}

function reactionGroups(
  state: FixtureState,
  reactions: FixtureReactions | undefined
): RawReactionGroup[] {
  const v = state.viewer.login
  // GitHub 처럼 여덟 종류 모두(0 명 포함)
  return REACTION_CONTENTS.map((content) => {
    const users = reactions?.[content] ?? []
    return { content, viewerHasReacted: users.includes(v), reactors: { totalCount: users.length } }
  })
}

function linkedPullRequest(
  ctx: GraphQLContext,
  pr: FixtureLinkedPullRequest
): RawLinkedPullRequest {
  return {
    __typename: 'PullRequest',
    number: pr.number,
    title: pr.title,
    state: pr.state,
    url: `${ctx.webBase}/${pr.repo}/pull/${pr.number}`,
    repository: { nameWithOwner: pr.repo }
  }
}

/** 내 권한으로 할 수 있는 일(응답 때 현재 상태로 계산) */
function viewerAbilities(state: FixtureState, repo: FixtureRepo, item: FixtureItem) {
  const canWrite = WRITE_PERMISSIONS.includes(repo.viewerPermission)
  const canTriage = repo.viewerPermission !== 'READ'
  const isAuthor = item.author === state.viewer.login
  const open = isOpen(item)
  const locked = item.locked === true
  return {
    canClose: open && (canTriage || isAuthor),
    canReopen: !open && (canTriage || isAuthor),
    // 잠긴 이슈는 쓰기 권한자만 반응·코멘트할 수 있다
    canReact: !locked || canWrite,
    canComment: !locked || canWrite
  }
}

/** 새 코멘트·이슈의 내 authorAssociation */
export function viewerAssociation(state: FixtureState, repo: FixtureRepo): string {
  const v = state.viewer.login
  if (repo.owner === v) return 'OWNER'
  if (WRITE_PERMISSIONS.includes(repo.viewerPermission)) {
    const owner = state.actors.find((a) => a.login === repo.owner)
    return owner?.type === 'Organization' ? 'MEMBER' : 'COLLABORATOR'
  }
  return repo.contributors.some((c) => c.login === v) ? 'CONTRIBUTOR' : 'NONE'
}

function commentBody(c: FixtureResponse): string {
  return c.bodyHTML ?? `<p>Comment from ${escapeHtml(c.login)}.</p>`
}

function renderComment(
  ctx: GraphQLContext,
  item: FixtureItem,
  c: FixtureResponse
): RawIssueComment {
  return {
    id: c.id ?? commentNodeId(item, item.comments.indexOf(c)),
    createdAt: c.createdAt,
    bodyHTML: commentBody(c),
    author: rawActor(ctx.state, c.login),
    reactionGroups: reactionGroups(ctx.state, c.reactions)
  }
}

function renderTimeline(ctx: GraphQLContext, item: FixtureItem): RawIssueTimelineItem[] {
  return (item.timeline ?? []).map((e) => {
    if (e.type === 'ReferencedEvent') {
      const user = actorOf(ctx.state, e.author)
      return {
        __typename: 'ReferencedEvent',
        commitRepository: { nameWithOwner: e.repo },
        commit: {
          oid: e.oid,
          messageHeadline: e.message.split('\n', 1)[0] ?? '',
          committedDate: e.committedDate,
          url: `${ctx.webBase}/${e.repo}/commit/${e.oid}`,
          author: { name: user.name ?? user.login, user: rawActor(ctx.state, e.author) }
        }
      }
    }
    const pr = linkedPullRequest(ctx, e.pr)
    if (e.type === 'CrossReferencedEvent') return { __typename: e.type, source: pr }
    // 연결·연결 해제: GitHub 는 source 나 subject 중 하나에 PR 을 준다
    return { __typename: e.type, source: {}, subject: pr }
  })
}

function issueDetail(ctx: GraphQLContext, vars: Vars): GraphQLBody {
  const repo = findRepoByName(ctx.state, vars.owner, vars.name)
  if (!repo) {
    return {
      data: { repository: null },
      errors: [
        {
          type: 'NOT_FOUND',
          path: ['repository'],
          message: `Could not resolve to a Repository with the name '${String(vars.owner)}/${String(vars.name)}'.`
        }
      ]
    }
  }
  const base = {
    databaseId: repo.id,
    nameWithOwner: fullName(repo),
    viewerPermission: repo.viewerPermission
  }
  const item = ctx.state.items.find(
    (i) => i.repoId === repo.id && i.kind === 'Issue' && i.number === vars.number
  )
  if (!item) {
    return {
      data: { repository: { ...base, issue: null } },
      errors: [
        {
          type: 'NOT_FOUND',
          path: ['repository', 'issue'],
          message: `Could not resolve to an Issue with the number of ${String(vars.number)}.`
        }
      ]
    }
  }
  const commentCount = num(vars.commentCount, 100)
  const labelCount = num(vars.labelCount, 50)
  const closingCount = num(vars.closingCount, 25)
  const timelineCount = num(vars.timelineCount, 100)
  const can = viewerAbilities(ctx.state, repo, item)
  const comments = [...item.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const repository: RawIssueDetailRepository = {
    ...base,
    issue: {
      id: item.nodeId,
      number: item.number,
      url: itemUrl(ctx, repo, item),
      title: item.title,
      state: isOpen(item) ? 'OPEN' : 'CLOSED',
      stateReason: item.stateReason ?? null,
      locked: item.locked === true,
      createdAt: item.createdAt,
      bodyHTML: item.bodyHTML ?? `<p>${escapeHtml(item.title)}</p>`,
      author: rawActor(ctx.state, item.author),
      labels: { nodes: item.labels.slice(0, labelCount).map((l) => ({ ...l })) },
      assignees: { nodes: item.assignees.slice(0, labelCount).map((a) => rawActor(ctx.state, a)) },
      reactionGroups: reactionGroups(ctx.state, item.reactions),
      viewerCanClose: can.canClose,
      viewerCanReopen: can.canReopen,
      viewerCanReact: can.canReact,
      comments: {
        totalCount: comments.length,
        nodes: comments.slice(0, commentCount).map((c) => renderComment(ctx, item, c))
      },
      closedByPullRequestsReferences: {
        nodes: (item.closingPullRequests ?? [])
          .slice(0, closingCount)
          .map((pr) => linkedPullRequest(ctx, pr))
      },
      timelineItems: { nodes: renderTimeline(ctx, item).slice(0, timelineCount) }
    }
  }
  return { data: { repository } }
}

// ───────────────────────── 쓰기(mutation) ─────────────────────────

/** mutation 실패: data 가 null 이어야 앱 클라이언트가 실패로 본다 */
function mutationError(type: string, message: string, path: string): GraphQLBody {
  return { data: null, errors: [{ type, message, path: [path] }] }
}

function issueByNodeId(state: FixtureState, id: unknown): FixtureItem | null {
  return state.items.find((i) => i.kind === 'Issue' && i.nodeId === id) ?? null
}

/** 반응 대상: 이슈 또는 이슈 코멘트 */
function reactionSubject(
  state: FixtureState,
  id: unknown
): { item: FixtureItem; target: { reactions?: FixtureReactions } } | null {
  const issue = issueByNodeId(state, id)
  if (issue) return { item: issue, target: issue }
  for (const item of state.items) {
    if (item.kind !== 'Issue') continue
    const index = item.comments.findIndex((c, i) => (c.id ?? commentNodeId(item, i)) === id)
    const comment = item.comments[index]
    if (comment) return { item, target: comment }
  }
  return null
}

function reactionMutation(field: 'addReaction' | 'removeReaction') {
  return (ctx: GraphQLContext, vars: Vars): GraphQLBody => {
    const subject = reactionSubject(ctx.state, vars.subjectId)
    if (!subject) {
      return mutationError(
        'NOT_FOUND',
        `Could not resolve to a node with the global id of '${String(vars.subjectId)}'.`,
        field
      )
    }
    const content = REACTION_CONTENTS.find((c) => c === vars.content)
    if (!content) {
      return mutationError('INVALID', `Invalid reaction content '${String(vars.content)}'.`, field)
    }
    const repo = repoById(ctx.state, subject.item.repoId)
    if (!viewerAbilities(ctx.state, repo, subject.item).canReact) {
      return mutationError('FORBIDDEN', 'Unable to react: the issue is locked.', field)
    }
    const v = ctx.state.viewer.login
    const reactions: FixtureReactions = { ...subject.target.reactions }
    const users = (reactions[content] ?? []).filter((u) => u !== v)
    if (field === 'addReaction') users.push(v)
    reactions[content] = users
    subject.target.reactions = reactions
    return {
      data: { [field]: { reaction: { content }, subject: { id: vars.subjectId } } }
    }
  }
}

function addComment(ctx: GraphQLContext, vars: Vars): GraphQLBody {
  const item = issueByNodeId(ctx.state, vars.subjectId)
  if (!item) {
    return mutationError(
      'NOT_FOUND',
      `Could not resolve to a node with the global id of '${String(vars.subjectId)}'.`,
      'addComment'
    )
  }
  const body = typeof vars.body === 'string' ? vars.body : ''
  if (body.trim() === '') {
    return mutationError('UNPROCESSABLE', 'Body cannot be blank', 'addComment')
  }
  const repo = repoById(ctx.state, item.repoId)
  if (!viewerAbilities(ctx.state, repo, item).canComment) {
    return mutationError(
      'FORBIDDEN',
      'Unable to create comment because issue is locked.',
      'addComment'
    )
  }
  const at = new Date(nowOf(ctx)).toISOString()
  const comment: FixtureResponse = {
    login: ctx.state.viewer.login,
    authorAssociation: viewerAssociation(ctx.state, repo),
    createdAt: at,
    id: commentNodeId(item, item.comments.length),
    bodyHTML: renderMarkdownLite(body),
    reactions: {}
  }
  item.comments.push(comment)
  item.updatedAt = at
  return {
    data: { addComment: { commentEdge: { node: renderComment(ctx, item, comment) } } }
  }
}

function setIssueState(field: 'closeIssue' | 'reopenIssue') {
  return (ctx: GraphQLContext, vars: Vars): GraphQLBody => {
    const item = issueByNodeId(ctx.state, vars.issueId)
    if (!item) {
      return mutationError(
        'NOT_FOUND',
        `Could not resolve to a node with the global id of '${String(vars.issueId)}'.`,
        field
      )
    }
    const can = viewerAbilities(ctx.state, repoById(ctx.state, item.repoId), item)
    if (field === 'closeIssue') {
      if (!can.canClose && isOpen(item)) {
        return mutationError('FORBIDDEN', 'You do not have permission to close this issue.', field)
      }
      const reason = vars.stateReason === 'NOT_PLANNED' ? 'NOT_PLANNED' : 'COMPLETED'
      item.state = 'CLOSED'
      item.stateReason = reason
    } else {
      if (!can.canReopen && !isOpen(item)) {
        return mutationError('FORBIDDEN', 'You do not have permission to reopen this issue.', field)
      }
      item.state = 'OPEN'
      item.stateReason = 'REOPENED'
    }
    item.updatedAt = new Date(nowOf(ctx)).toISOString()
    return {
      data: {
        [field]: {
          issue: { id: item.nodeId, state: item.state, stateReason: item.stateReason ?? null }
        }
      }
    }
  }
}

const MUTATIONS: Record<string, ((ctx: GraphQLContext, vars: Vars) => GraphQLBody) | undefined> = {
  [OPERATIONS.addReaction]: reactionMutation('addReaction'),
  [OPERATIONS.removeReaction]: reactionMutation('removeReaction'),
  [OPERATIONS.addComment]: addComment,
  [OPERATIONS.closeIssue]: setIssueState('closeIssue'),
  [OPERATIONS.reopenIssue]: setIssueState('reopenIssue')
}

/** 쓰기로 셀 GraphQL 작업(failNextWrites 대상) */
export const MUTATION_OPERATIONS: readonly string[] = Object.keys(MUTATIONS)
