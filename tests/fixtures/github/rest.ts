import { createHash } from 'node:crypto'
import type {
  RawContributor,
  RawNotification,
  RawStargazer
} from '../../../src/main/github/collectors/raw'
import { avatarUrl, fullName } from './data'
import type { FixtureItem, FixtureNotification, FixtureRepo, FixtureState } from './data'
import { escapeHtml, renderMarkdownLite, repoItems, viewerAssociation } from './graphql'

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
  /** 요청 본문(JSON 이면 파싱한 값) */
  body?: unknown
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
    has_issues: repo.hasIssuesEnabled,
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

/**
 * `GET /search/repositories?q=`: 한정자(`in:name` 같은 `키:값`)는 무시하고, 남은 낱말이 모두
 * 저장소 이름(owner/name)이나 설명에 들어 있으면 맞는 것으로 본다. 스타 많은 순.
 */
function searchRepositories(ctx: RestContext, req: RestRequest): FakeResponse {
  const q = (req.query.get('q') ?? '').trim()
  if (q === '') {
    return json(
      {
        message: 'Validation Failed',
        errors: [{ resource: 'Search', field: 'q', code: 'missing' }],
        documentation_url: 'https://docs.github.com/rest/search/search#search-repositories'
      },
      422
    )
  }
  const terms = q
    .split(/\s+/)
    .filter((w) => w !== '' && !w.includes(':'))
    .map((w) => w.toLowerCase())
  const list = ctx.state.repos
    .filter((repo) => {
      const haystack = `${fullName(repo)} ${repo.description ?? ''}`.toLowerCase()
      return terms.every((w) => haystack.includes(w))
    })
    .sort((a, b) => b.stargazers.length - a.stargazers.length || a.id - b.id)
    .map((repo) => ({ ...restRepository(ctx, repo), score: 1 }))
  const { items, headers } = paginate(ctx, req, list, 30)
  return json({ total_count: list.length, incomplete_results: false, items }, 200, headers)
}

function validationFailed(field: string, code: string, doc: string): FakeResponse {
  return json(
    {
      message: 'Validation Failed',
      errors: [{ resource: 'Issue', field, code }],
      documentation_url: `https://docs.github.com/rest/${doc}`
    },
    422
  )
}

/**
 * `GET /search/commits?q=author:<login>`: `author:` 와 `repo:` 한정자만 보고, 나머지 낱말은 메시지에 모두 들어 있어야
 * 한다. 작성 시각 최신순(order=asc 면 오래된 순). 검색 한도(search)를 쓴다.
 */
function searchCommits(ctx: RestContext, req: RestRequest): FakeResponse {
  const q = (req.query.get('q') ?? '').trim()
  if (q === '') return validationFailed('q', 'missing', 'search/search#search-commits')
  let author: string | null = null
  let repoName: string | null = null
  const words: string[] = []
  for (const token of q.split(/\s+/)) {
    const m = /^([a-z-]+):(.*)$/i.exec(token)
    if (m?.[1]?.toLowerCase() === 'author') author = (m[2] ?? '').toLowerCase()
    else if (m?.[1]?.toLowerCase() === 'repo') repoName = (m[2] ?? '').toLowerCase()
    else if (!m && token !== '') words.push(token.toLowerCase())
  }
  const asc = req.query.get('order') === 'asc'
  const list = ctx.state.searchCommits
    .filter((c) => author === null || c.author.toLowerCase() === author)
    .filter((c) => {
      const repo = ctx.state.repos.find((r) => r.id === c.repoId)
      if (!repo) return false
      if (repoName !== null && fullName(repo).toLowerCase() !== repoName) return false
      return words.every((w) => c.message.toLowerCase().includes(w))
    })
    .sort((a, b) =>
      asc ? a.authoredAt.localeCompare(b.authoredAt) : b.authoredAt.localeCompare(a.authoredAt)
    )
    .map((c) => {
      const repo = ctx.state.repos.find((r) => r.id === c.repoId) as FixtureRepo
      const name = fullName(repo)
      const actor = ctx.state.actors.find((a) => a.login === c.author)
      const person = {
        name: actor?.name ?? c.author,
        email: `${c.author}@users.noreply.test`,
        date: c.authoredAt
      }
      return {
        url: `${ctx.apiBase}/repos/${name}/commits/${c.oid}`,
        sha: c.oid,
        node_id: `C_kwDO${repo.id}_${c.oid.slice(0, 7)}`,
        html_url: `${ctx.webBase}/${name}/commit/${c.oid}`,
        commit: { author: person, committer: person, message: c.message, comment_count: 0 },
        author: restOwner(ctx, c.author),
        committer: restOwner(ctx, c.author),
        parents: [],
        repository: {
          id: repo.id,
          node_id: repo.nodeId,
          name: repo.name,
          full_name: name,
          private: repo.isPrivate,
          owner: restOwner(ctx, repo.owner),
          html_url: `${ctx.webBase}/${name}`
        },
        score: 1
      }
    })
  const { items, headers } = paginate(ctx, req, list, 30)
  return json({ total_count: list.length, incomplete_results: false, items }, 200, headers)
}

function restLabel(repo: FixtureRepo, name: string, color: string, description: string | null) {
  return {
    id: repo.id * 1000 + [...name].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 997, 7),
    node_id: `LA_kwDO${repo.id}_${encodeURIComponent(name)}`,
    name,
    color,
    description,
    default: false
  }
}

/** 저장소의 다음 이슈·PR 번호(항목과 연결 PR 번호 중 가장 큰 것 + 1) */
function nextNumber(state: FixtureState, repo: FixtureRepo): number {
  const name = fullName(repo)
  let max = 0
  for (const item of state.items) {
    if (item.repoId === repo.id) max = Math.max(max, item.number)
    for (const pr of item.closingPullRequests ?? []) {
      if (pr.repo === name) max = Math.max(max, pr.number)
    }
    for (const e of item.timeline ?? []) {
      if (e.type !== 'ReferencedEvent' && e.pr.repo === name) max = Math.max(max, e.pr.number)
    }
  }
  return max + 1
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * `POST /repos/{o}/{r}/issues`: 이슈를 상태에 더하고 201. 이슈 기능이 꺼졌으면 410, 보관됐으면 403.
 * 라벨은 이름으로 저장소 라벨에서 찾고(없으면 새로 만든다), 담당자는 지정 가능한 사용자만 남긴다.
 * 분류 권한(TRIAGE) 이상이 아니면 라벨·담당자는 조용히 버린다(GitHub 와 같음).
 * 만든 이슈는 검색 반영이 늦는다: indexCreatedIssues() 전에는 GraphQL 검색에 나오지 않는다.
 */
function createIssue(ctx: RestContext, req: RestRequest, repo: FixtureRepo): FakeResponse {
  if (repo.isArchived) {
    return json({ message: 'Repository was archived so is read-only.' }, 403)
  }
  if (!repo.hasIssuesEnabled) {
    return json(
      {
        message: 'Issues are disabled for this repo',
        documentation_url: 'https://docs.github.com/rest/issues/issues#create-an-issue'
      },
      410
    )
  }
  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<
    string,
    unknown
  >
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title === '')
    return validationFailed('title', 'missing_field', 'issues/issues#create-an-issue')
  const text = typeof body.body === 'string' ? body.body : ''
  const canTriage = repo.viewerPermission !== 'READ'
  const labels = canTriage
    ? [...new Set(stringList(body.labels))].map((name) => {
        const found = repo.labels.find((l) => l.name.toLowerCase() === name.toLowerCase())
        if (found) return found
        const created = { name, color: 'ededed', description: null }
        repo.labels.push(created)
        return created
      })
    : []
  const assignees = canTriage
    ? [...new Set(stringList(body.assignees))].filter((a) => repo.assignableUsers.includes(a))
    : []
  const nowMs = ctx.now()
  const at = new Date(nowMs).toISOString()
  const number = nextNumber(ctx.state, repo)
  const item: FixtureItem = {
    kind: 'Issue',
    nodeId: `I_kwDO${repo.id}_${number}`,
    repoId: repo.id,
    number,
    title,
    author: ctx.state.viewer.login,
    authorAssociation: viewerAssociation(ctx.state, repo),
    createdAt: at,
    updatedAt: at,
    comments: [],
    reviews: [],
    isDraft: false,
    reviewDecision: null,
    ciState: null,
    labels: labels.map((l) => ({ name: l.name, color: l.color })),
    assignees,
    reviewRequests: [],
    bodyHTML: text.trim() === '' ? '' : renderMarkdownLite(text),
    createdInAppAt: nowMs,
    searchIndexed: false
  }
  ctx.state.items.push(item)
  const name = fullName(repo)
  return json(
    {
      id: repo.id * 100_000 + number,
      node_id: item.nodeId,
      url: `${ctx.apiBase}/repos/${name}/issues/${number}`,
      html_url: `${ctx.webBase}/${name}/issues/${number}`,
      number,
      state: 'open',
      state_reason: null,
      title,
      body: text === '' ? null : text,
      user: restOwner(ctx, item.author),
      labels: labels.map((l) => restLabel(repo, l.name, l.color, l.description)),
      assignee: assignees[0] ? restOwner(ctx, assignees[0]) : null,
      assignees: assignees.map((a) => restOwner(ctx, a)),
      locked: false,
      comments: 0,
      author_association: item.authorAssociation,
      created_at: at,
      updated_at: at,
      closed_at: null
    },
    201,
    { location: `${ctx.apiBase}/repos/${name}/issues/${number}` }
  )
}

/**
 * `POST /markdown`: 간단한 변환(이스케이프 + 문단 + `**굵게**`)을 표식 요소로 감싸 text/html 로 준다.
 * 표식: `<div data-fake-markdown="{mode}" data-context="{context}">` — 서버가 그렸다는 것을 테스트가 확인할 수 있다.
 */
function renderMarkdown(req: RestRequest): FakeResponse {
  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<
    string,
    unknown
  >
  if (typeof body.text !== 'string') {
    return json(
      {
        message: 'Invalid request.\n\n"text" wasn\'t supplied.',
        documentation_url:
          'https://docs.github.com/rest/markdown/markdown#render-a-markdown-document'
      },
      422
    )
  }
  const mode = typeof body.mode === 'string' ? body.mode : 'markdown'
  const context = typeof body.context === 'string' ? body.context : ''
  const html = `<div data-fake-markdown="${escapeHtml(mode)}" data-context="${escapeHtml(context)}">${renderMarkdownLite(body.text)}</div>`
  return { status: 200, body: html, headers: { 'content-type': 'text/html;charset=utf-8' } }
}

const RE = {
  thread: /^\/notifications\/threads\/([^/]+)$/,
  repositoryById: /^\/repositories\/(\d+)$/,
  repo: /^\/repos\/([^/]+)\/([^/]+)$/,
  contributors: /^\/repos\/([^/]+)\/([^/]+)\/contributors$/,
  stargazers: /^\/repos\/([^/]+)\/([^/]+)\/stargazers$/,
  starred: /^\/user\/starred\/([^/]+)\/([^/]+)$/,
  issues: /^\/repos\/([^/]+)\/([^/]+)\/issues$/,
  labels: /^\/repos\/([^/]+)\/([^/]+)\/labels$/,
  assignees: /^\/repos\/([^/]+)\/([^/]+)\/assignees$/
}

function repoFromMatch(ctx: RestContext, m: RegExpExecArray): FixtureRepo | null {
  return (
    findRepo(ctx, decodeURIComponent(m[1] as string), decodeURIComponent(m[2] as string))?.repo ??
    null
  )
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
        email: ctx.state.viewerEmail,
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

  if (path === '/search/repositories' && method === 'GET') return searchRepositories(ctx, req)
  if (path === '/search/commits' && method === 'GET') return searchCommits(ctx, req)
  if (path === '/markdown' && method === 'POST') return renderMarkdown(req)

  if ((m = RE.issues.exec(path)) && method === 'POST') {
    const repo = repoFromMatch(ctx, m)
    return repo ? createIssue(ctx, req, repo) : notFound()
  }

  if ((m = RE.labels.exec(path)) && method === 'GET') {
    const repo = repoFromMatch(ctx, m)
    if (!repo) return notFound()
    const list = repo.labels.map((l) => restLabel(repo, l.name, l.color, l.description))
    const { items, headers } = paginate(ctx, req, list, 30)
    return json(items, 200, headers)
  }

  if ((m = RE.assignees.exec(path)) && method === 'GET') {
    const repo = repoFromMatch(ctx, m)
    if (!repo) return notFound()
    const list = repo.assignableUsers.map((login) => restOwner(ctx, login))
    const { items, headers } = paginate(ctx, req, list, 30)
    return json(items, 200, headers)
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
