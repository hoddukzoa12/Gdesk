import { createHash } from 'node:crypto'
import type {
  RawContributor,
  RawNotification,
  RawStargazer
} from '../../../src/main/github/collectors/raw'
import { avatarUrl, fullName } from './data'
import type { FixtureNotification, FixtureRepo, FixtureState } from './data'
import { repoItems } from './graphql'

/**
 * REST 응답 만들기. 경로는 API 주소 기준(`/api` 를 뗀 것). 쓰기는 상태를 바꾼다.
 * Link 헤더의 주소는 언제나 이 서버의 apiBase 를 쓴다(클라이언트는 API 주소 밖 링크를 거부한다).
 */

export interface RestContext {
  state: FixtureState
  apiBase: string
  webBase: string
  /** GET /user 의 X-OAuth-Scopes. null 이면 헤더를 보내지 않는다(세분화 토큰) */
  scopes: string | null
  /** 세분화 토큰 흉내: /notifications 가 403 */
  fineGrained: boolean
  /** 알림 응답의 X-Poll-Interval(초) */
  pollInterval: number
  /** 알림 상태가 바뀐 시각(ms). Last-Modified 에 쓴다 */
  notificationsChangedAt: number
  /** 알림이 바뀌었다고 알린다(Last-Modified 를 민다) */
  touchNotifications: () => void
  now: () => number
}

export interface RestRequest {
  method: string
  /** API 기준 경로(쿼리 제외) */
  path: string
  query: URLSearchParams
  headers: Record<string, string>
}

export interface FakeResponse {
  status: number
  /** 객체면 JSON, 문자열이면 그대로. 204·205·304 는 무시 */
  body?: unknown
  headers?: Record<string, string>
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): FakeResponse => ({
  status,
  body,
  headers
})
const empty = (status: number, headers: Record<string, string> = {}): FakeResponse => ({
  status,
  headers
})
const notFound = (): FakeResponse =>
  json({ message: 'Not Found', documentation_url: 'https://docs.github.com/rest' }, 404)

function clampInt(value: string | null, fallback: number, max: number): number {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback
}

/** GitHub 식 페이지 나누기 + Link 헤더(first·prev·next·last) */
function paginate<T>(
  ctx: RestContext,
  req: RestRequest,
  list: T[],
  defaultPerPage: number
): { items: T[]; headers: Record<string, string> } {
  const perPage = clampInt(req.query.get('per_page'), defaultPerPage, 100)
  const pageNo = clampInt(req.query.get('page'), 1, Number.MAX_SAFE_INTEGER)
  const lastPage = Math.max(1, Math.ceil(list.length / perPage))
  const items = list.slice((pageNo - 1) * perPage, pageNo * perPage)
  const linkTo = (p: number): string => {
    const q = new URLSearchParams(req.query)
    q.set('per_page', String(perPage))
    q.set('page', String(p))
    return `${ctx.apiBase}${req.path}?${q.toString()}`
  }
  const rels: string[] = []
  if (pageNo > 1) {
    rels.push(`<${linkTo(pageNo - 1)}>; rel="prev"`)
    rels.push(`<${linkTo(1)}>; rel="first"`)
  }
  if (pageNo < lastPage) {
    rels.push(`<${linkTo(pageNo + 1)}>; rel="next"`)
    rels.push(`<${linkTo(lastPage)}>; rel="last"`)
  }
  return { items, headers: rels.length > 0 ? { link: rels.join(', ') } : {} }
}

function restOwner(ctx: RestContext, login: string) {
  const actor = ctx.state.actors.find((a) => a.login === login)
  return {
    login,
    id: actor?.id ?? 0,
    avatar_url: avatarUrl(login),
    html_url: `${ctx.webBase}/${login}`,
    type: actor?.type ?? 'User'
  }
}

export function restRepository(ctx: RestContext, repo: FixtureRepo) {
  const name = fullName(repo)
  const p = repo.viewerPermission
  const openItems =
    repoItems(ctx.state, repo.id, 'PullRequest').length +
    repoItems(ctx.state, repo.id, 'Issue').length
  return {
    id: repo.id,
    node_id: repo.nodeId,
    name: repo.name,
    full_name: name,
    private: repo.isPrivate,
    fork: repo.isFork,
    archived: repo.isArchived,
    owner: restOwner(ctx, repo.owner),
    html_url: `${ctx.webBase}/${name}`,
    url: `${ctx.apiBase}/repos/${name}`,
    clone_url: `${ctx.webBase}/${name}.git`,
    description: repo.description,
    homepage: repo.homepageUrl,
    language: repo.primaryLanguage?.name ?? null,
    license: repo.license
      ? {
          key: repo.license.spdxId.toLowerCase(),
          spdx_id: repo.license.spdxId,
          name: repo.license.name
        }
      : null,
    topics: [...repo.topics],
    default_branch: repo.defaultBranch,
    stargazers_count: repo.stargazers.length,
    watchers_count: repo.stargazers.length,
    forks_count: repo.forkCount,
    open_issues_count: openItems,
    pushed_at: repo.pushedAt,
    updated_at: repo.updatedAt,
    permissions: {
      admin: p === 'ADMIN',
      maintain: p === 'ADMIN' || p === 'MAINTAIN',
      push: p === 'ADMIN' || p === 'MAINTAIN' || p === 'WRITE',
      triage: p !== 'READ',
      pull: true
    }
  }
}

function findRepo(
  ctx: RestContext,
  owner: string,
  name: string
): { repo: FixtureRepo; renamed: boolean } | null {
  const key = `${owner}/${name}`.toLowerCase()
  for (const repo of ctx.state.repos) {
    if (fullName(repo).toLowerCase() === key) return { repo, renamed: false }
  }
  for (const repo of ctx.state.repos) {
    if (repo.previousNames.some((n) => n.toLowerCase() === key)) return { repo, renamed: true }
  }
  return null
}

type RestNotification = RawNotification & {
  last_read_at: string | null
  url: string
  subscription_url: string
}

function restNotification(ctx: RestContext, n: FixtureNotification): RestNotification {
  const repo = ctx.state.repos.find((r) => r.id === n.repoId)
  const name = repo ? fullName(repo) : ''
  return {
    id: n.id,
    unread: n.unread,
    reason: n.reason,
    updated_at: n.updatedAt,
    subject: {
      title: n.subjectTitle,
      url: n.subjectPath ? `${ctx.apiBase}${n.subjectPath}` : null,
      type: n.subjectType
    },
    repository: {
      id: n.repoId,
      full_name: name,
      html_url: `${ctx.webBase}/${name}`
    },
    last_read_at: n.unread ? null : n.updatedAt,
    url: `${ctx.apiBase}/notifications/threads/${n.id}`,
    subscription_url: `${ctx.apiBase}/notifications/threads/${n.id}/subscription`
  }
}

function etagOf(value: unknown): string {
  return `W/"${createHash('sha1').update(JSON.stringify(value)).digest('hex')}"`
}

function notifications(ctx: RestContext, req: RestRequest): FakeResponse {
  if (ctx.fineGrained) {
    return json(
      {
        message: 'Resource not accessible by personal access token',
        documentation_url: 'https://docs.github.com/rest/activity/notifications'
      },
      403
    )
  }
  const all = req.query.get('all') === 'true'
  const list = ctx.state.notifications
    .filter((n) => all || n.unread)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((n) => restNotification(ctx, n))
  const { items, headers } = paginate(ctx, req, list, 50)
  const etag = etagOf({ q: req.query.toString(), items })
  const lastModified = new Date(ctx.notificationsChangedAt).toUTCString()
  const meta = {
    ...headers,
    etag,
    'last-modified': lastModified,
    'x-poll-interval': String(ctx.pollInterval)
  }
  const ifNoneMatch = req.headers['if-none-match']
  const ifModifiedSince = req.headers['if-modified-since']
  if (ifNoneMatch !== undefined) {
    if (ifNoneMatch === etag) return empty(304, meta)
  } else if (ifModifiedSince !== undefined) {
    const since = Date.parse(ifModifiedSince)
    if (Number.isFinite(since) && Math.floor(ctx.notificationsChangedAt / 1000) * 1000 <= since) {
      return empty(304, meta)
    }
  }
  return json(items, 200, meta)
}

const RE = {
  thread: /^\/notifications\/threads\/([^/]+)$/,
  repositoryById: /^\/repositories\/(\d+)$/,
  repo: /^\/repos\/([^/]+)\/([^/]+)$/,
  contributors: /^\/repos\/([^/]+)\/([^/]+)\/contributors$/,
  stargazers: /^\/repos\/([^/]+)\/([^/]+)\/stargazers$/,
  starred: /^\/user\/starred\/([^/]+)\/([^/]+)$/
}

/** 경로가 맞는 것이 없으면 null (서버가 404) */
export function handleRest(ctx: RestContext, req: RestRequest): FakeResponse | null {
  const { method, path } = req
  let m: RegExpExecArray | null

  if (path === '/user' && method === 'GET') {
    const v = ctx.state.viewer
    const headers: Record<string, string> = {}
    if (ctx.scopes !== null) {
      headers['x-oauth-scopes'] = ctx.scopes
      headers['x-accepted-oauth-scopes'] = ''
    }
    return json(
      {
        login: v.login,
        id: v.id,
        node_id: `U_kgDO${v.id}`,
        avatar_url: avatarUrl(v.login),
        html_url: `${ctx.webBase}/${v.login}`,
        type: 'User',
        name: v.name,
        public_repos: ctx.state.repos.filter((r) => r.owner === v.login && !r.isPrivate).length
      },
      200,
      headers
    )
  }

  if (path === '/notifications') {
    if (method === 'GET') return notifications(ctx, req)
    if (method === 'PUT') {
      for (const n of ctx.state.notifications) n.unread = false
      ctx.touchNotifications()
      return empty(205)
    }
  }

  if ((m = RE.thread.exec(path))) {
    const id = decodeURIComponent(m[1] as string)
    const index = ctx.state.notifications.findIndex((n) => n.id === id)
    const thread = ctx.state.notifications[index]
    if (!thread) return notFound()
    if (method === 'GET') return json(restNotification(ctx, thread))
    if (method === 'PATCH') {
      thread.unread = false
      ctx.touchNotifications()
      return empty(205)
    }
    if (method === 'DELETE') {
      ctx.state.notifications.splice(index, 1)
      ctx.touchNotifications()
      return empty(204)
    }
    return null
  }

  if ((m = RE.repositoryById.exec(path)) && method === 'GET') {
    const repo = ctx.state.repos.find((r) => r.id === Number(m?.[1]))
    return repo ? json(restRepository(ctx, repo)) : notFound()
  }

  if ((m = RE.repo.exec(path)) && method === 'GET') {
    const found = findRepo(
      ctx,
      decodeURIComponent(m[1] as string),
      decodeURIComponent(m[2] as string)
    )
    if (!found) return notFound()
    if (found.renamed) {
      const location = `${ctx.apiBase}/repositories/${found.repo.id}`
      return json({ message: 'Moved Permanently', url: location }, 301, { location })
    }
    return json(restRepository(ctx, found.repo))
  }

  if ((m = RE.contributors.exec(path)) && method === 'GET') {
    const found = findRepo(
      ctx,
      decodeURIComponent(m[1] as string),
      decodeURIComponent(m[2] as string)
    )
    if (!found) return notFound()
    const list: RawContributor[] = [...found.repo.contributors]
      .sort((a, b) => b.contributions - a.contributions)
      .map((c) => ({
        login: c.login,
        avatar_url: avatarUrl(c.login),
        html_url: `${ctx.webBase}/${c.login}`,
        contributions: c.contributions,
        type: c.type
      }))
    if (list.length === 0) return empty(204)
    const { items, headers } = paginate(ctx, req, list, 30)
    return json(items, 200, headers)
  }

  if ((m = RE.stargazers.exec(path)) && method === 'GET') {
    const found = findRepo(
      ctx,
      decodeURIComponent(m[1] as string),
      decodeURIComponent(m[2] as string)
    )
    if (!found) return notFound()
    const starJson = (req.headers.accept ?? '').includes('application/vnd.github.star+json')
    const list = found.repo.stargazers.map((s) => {
      const user = restOwner(ctx, s.login)
      const entry: RawStargazer = { starred_at: s.starredAt, user }
      return starJson ? entry : user
    })
    const { items, headers } = paginate(ctx, req, list, 30)
    return json(items, 200, headers)
  }

  if ((m = RE.starred.exec(path))) {
    const found = findRepo(
      ctx,
      decodeURIComponent(m[1] as string),
      decodeURIComponent(m[2] as string)
    )
    if (!found) return notFound()
    const repo = found.repo
    const viewer = ctx.state.viewer.login
    if (method === 'GET') return repo.viewerStarredAt ? empty(204) : notFound()
    if (method === 'PUT') {
      if (!repo.viewerStarredAt) {
        const at = new Date(ctx.now()).toISOString()
        repo.viewerStarredAt = at
        repo.stargazers.push({ login: viewer, starredAt: at })
      }
      return empty(204)
    }
    if (method === 'DELETE') {
      repo.viewerStarredAt = null
      repo.stargazers = repo.stargazers.filter((s) => s.login !== viewer)
      return empty(204)
    }
    return null
  }

  return null
}
