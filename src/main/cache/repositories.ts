import type { DatabaseSync } from 'node:sqlite'
import type {
  RepoAccessStatus,
  RepoListOptions,
  RepoOwnerType,
  RepositorySummary,
  ViewerPermission
} from '@shared/domain/repo'
import { withTransaction } from '../db/transaction'
import { bool, jsonValue, likePattern, num, placeholders, str, strOrNull, sqlBool } from './rows'
import type { Row } from './rows'
import type { RepositoryRecord, StarredRepositoryRecord } from './types'

/**
 * 저장소 캐시. 기본 키는 GitHub 숫자 저장소 ID 라 이름이 바뀌거나 옮겨져도 같은 행을 갱신한다.
 * 머리글 쓰기(upsert)는 is_mine·starred_at 을 건드리지 않는다. 그 둘은 각 목록 쓰기 함수가 정한다.
 */

const COLUMNS = `id, node_id, owner, owner_type, owner_avatar_url, name, full_name, url, private, fork,
  archived, description, homepage_url, primary_language, primary_language_color, default_branch,
  license, stargazer_count, fork_count, open_pr_count, open_issue_count, pushed_at, updated_at,
  topics, viewer_permission, is_mine, viewer_has_starred, starred_at, access_status`

const SELECT = `SELECT ${COLUMNS} FROM cache_repositories`

const PERMISSIONS: readonly ViewerPermission[] = ['ADMIN', 'MAINTAIN', 'WRITE', 'TRIAGE', 'READ']

export function toRepositorySummary(row: Row): RepositorySummary {
  const permission = strOrNull(row, 'viewer_permission')
  return {
    id: num(row, 'id'),
    owner: str(row, 'owner'),
    ownerType: str(row, 'owner_type') === 'Organization' ? 'Organization' : 'User',
    ownerAvatarUrl: strOrNull(row, 'owner_avatar_url'),
    name: str(row, 'name'),
    fullName: str(row, 'full_name'),
    url: str(row, 'url'),
    private: bool(row, 'private'),
    fork: bool(row, 'fork'),
    archived: bool(row, 'archived'),
    description: strOrNull(row, 'description'),
    homepageUrl: strOrNull(row, 'homepage_url'),
    primaryLanguage: strOrNull(row, 'primary_language'),
    primaryLanguageColor: strOrNull(row, 'primary_language_color'),
    defaultBranch: strOrNull(row, 'default_branch'),
    license: strOrNull(row, 'license'),
    stargazerCount: num(row, 'stargazer_count'),
    forkCount: num(row, 'fork_count'),
    openPullRequestCount: num(row, 'open_pr_count'),
    openIssueCount: num(row, 'open_issue_count'),
    pushedAt: strOrNull(row, 'pushed_at'),
    updatedAt: strOrNull(row, 'updated_at'),
    topics: jsonValue<string[]>(row, 'topics', []),
    viewerPermission: PERMISSIONS.find((p) => p === permission) ?? null,
    isMine: bool(row, 'is_mine'),
    viewerHasStarred: bool(row, 'viewer_has_starred'),
    starredAt: strOrNull(row, 'starred_at'),
    accessStatus: str(row, 'access_status') === 'unavailable' ? 'unavailable' : 'available'
  }
}

/**
 * 머리글을 넣거나 갱신한다. GitHub 응답으로 받은 저장소는 접근 가능하므로 access_status 를 available 로 둔다.
 * is_mine·starred_at 은 그대로 둔다(새 행은 is_mine=0).
 */
export function upsertRepositories(
  db: DatabaseSync,
  repos: readonly RepositoryRecord[],
  now: number = Date.now()
): void {
  if (repos.length === 0) return
  const stmt = db.prepare(
    `INSERT INTO cache_repositories (id, node_id, owner, owner_type, owner_avatar_url, name, full_name,
       url, private, fork, archived, description, homepage_url, primary_language,
       primary_language_color, default_branch, license, stargazer_count, fork_count, open_pr_count,
       open_issue_count, pushed_at, updated_at, topics, viewer_permission, viewer_has_starred,
       access_status, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)
     ON CONFLICT (id) DO UPDATE SET
       node_id = COALESCE(excluded.node_id, node_id),
       owner = excluded.owner,
       owner_type = excluded.owner_type,
       owner_avatar_url = excluded.owner_avatar_url,
       name = excluded.name,
       full_name = excluded.full_name,
       url = excluded.url,
       private = excluded.private,
       fork = excluded.fork,
       archived = excluded.archived,
       description = excluded.description,
       homepage_url = excluded.homepage_url,
       primary_language = excluded.primary_language,
       primary_language_color = excluded.primary_language_color,
       default_branch = excluded.default_branch,
       license = excluded.license,
       stargazer_count = excluded.stargazer_count,
       fork_count = excluded.fork_count,
       open_pr_count = excluded.open_pr_count,
       open_issue_count = excluded.open_issue_count,
       pushed_at = excluded.pushed_at,
       updated_at = excluded.updated_at,
       topics = excluded.topics,
       viewer_permission = excluded.viewer_permission,
       viewer_has_starred = excluded.viewer_has_starred,
       access_status = 'available',
       synced_at = excluded.synced_at`
  )
  withTransaction(db, () => {
    for (const r of repos) {
      stmt.run(
        r.id,
        r.nodeId,
        r.owner,
        r.ownerType,
        r.ownerAvatarUrl,
        r.name,
        r.fullName,
        r.url,
        sqlBool(r.private),
        sqlBool(r.fork),
        sqlBool(r.archived),
        r.description,
        r.homepageUrl,
        r.primaryLanguage,
        r.primaryLanguageColor,
        r.defaultBranch,
        r.license,
        r.stargazerCount,
        r.forkCount,
        r.openPullRequestCount,
        r.openIssueCount,
        r.pushedAt,
        r.updatedAt,
        JSON.stringify(r.topics),
        r.viewerPermission,
        sqlBool(r.viewerHasStarred),
        now
      )
    }
  })
}

export interface ReplaceMyRepositoriesOptions {
  /**
   * 내 집합에서 빠진 저장소 중 접근 여부를 확인한 것(고정·연결된 저장소, GET /repositories/{id}).
   * unavailable 이면 표시하고, available 이면 표시를 푼다. 여기 없는 저장소의 접근 상태는 그대로 둔다.
   * 고정·연결 자체는 지우지 않는다.
   */
  accessStatuses?: ReadonlyMap<number, RepoAccessStatus>
  now?: number
}

/**
 * 내 저장소 집합 전체를 바꾼다. 받은 저장소는 is_mine=1, 빠진 저장소는 is_mine=0.
 * 빠진 저장소의 접근 상태는 확인 결과(accessStatuses)가 있을 때만 바꾼다.
 */
export function replaceMyRepositories(
  db: DatabaseSync,
  repos: readonly RepositoryRecord[],
  options: ReplaceMyRepositoriesOptions = {}
): void {
  const ids = new Set(repos.map((r) => r.id))
  withTransaction(db, () => {
    const previous = listMyRepositoryIds(db)
    upsertRepositories(db, repos, options.now)
    const setMine = db.prepare('UPDATE cache_repositories SET is_mine = ? WHERE id = ?')
    for (const id of ids) setMine.run(1, id)
    for (const id of previous) {
      if (ids.has(id)) continue
      setMine.run(0, id)
      const status = options.accessStatuses?.get(id)
      if (status) setRepositoryAccessStatus(db, id, status)
    }
  })
}

/** 지금 캐시의 내 저장소 집합 ID */
export function listMyRepositoryIds(db: DatabaseSync): number[] {
  return db
    .prepare('SELECT id FROM cache_repositories WHERE is_mine = 1')
    .all()
    .map((row) => num(row, 'id'))
}

/** 스타한 저장소 목록 전체를 바꾼다. is_mine 은 건드리지 않는다 */
export function replaceStarredRepositories(
  db: DatabaseSync,
  items: readonly StarredRepositoryRecord[],
  now: number = Date.now()
): void {
  withTransaction(db, () => {
    upsertRepositories(
      db,
      items.map((i) => ({ ...i.repository, viewerHasStarred: true })),
      now
    )
    const ids = items.map((i) => i.repository.id)
    if (ids.length > 0) {
      db.prepare(
        `UPDATE cache_repositories SET viewer_has_starred = 0, starred_at = NULL
         WHERE (viewer_has_starred = 1 OR starred_at IS NOT NULL) AND id NOT IN (${placeholders(ids.length)})`
      ).run(...ids)
    } else {
      db.exec(
        'UPDATE cache_repositories SET viewer_has_starred = 0, starred_at = NULL WHERE viewer_has_starred = 1 OR starred_at IS NOT NULL'
      )
    }
    const setStarredAt = db.prepare(
      'UPDATE cache_repositories SET viewer_has_starred = 1, starred_at = ? WHERE id = ?'
    )
    for (const item of items) setStarredAt.run(item.starredAt, item.repository.id)
  })
}

export function setRepositoryAccessStatus(
  db: DatabaseSync,
  repoId: number,
  status: RepoAccessStatus
): boolean {
  if (status !== 'available' && status !== 'unavailable') {
    throw new Error(`Invalid access status: ${String(status)}`)
  }
  return (
    Number(
      db.prepare('UPDATE cache_repositories SET access_status = ? WHERE id = ?').run(status, repoId)
        .changes
    ) > 0
  )
}

export function getRepository(db: DatabaseSync, repoId: number): RepositorySummary | null {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(repoId)
  return row === undefined ? null : toRepositorySummary(row)
}

/** 여러 저장소를 ID 로 읽는다(캐시에 없는 ID 는 빠진다). 순서는 ids 순 */
export function getRepositories(db: DatabaseSync, ids: readonly number[]): RepositorySummary[] {
  if (ids.length === 0) return []
  const rows = db.prepare(`${SELECT} WHERE id IN (${placeholders(ids.length)})`).all(...ids)
  const byId = new Map(rows.map((r) => [num(r, 'id'), toRepositorySummary(r)]))
  return ids.flatMap((id) => byId.get(id) ?? [])
}

/** 고정·연결 표시용 접근 상태. 캐시에 없는 ID 는 빠진다 */
export function getRepositoryAccessStatuses(
  db: DatabaseSync,
  ids: readonly number[]
): Record<number, RepoAccessStatus> {
  const out: Record<number, RepoAccessStatus> = {}
  if (ids.length === 0) return out
  for (const row of db
    .prepare(
      `SELECT id, access_status FROM cache_repositories WHERE id IN (${placeholders(ids.length)})`
    )
    .all(...ids)) {
    out[num(row, 'id')] = str(row, 'access_status') === 'unavailable' ? 'unavailable' : 'available'
  }
  return out
}

/** 캐시의 모든 저장소(내 것·스타·고정한 남의 저장소·본 저장소·검색 결과)의 전체 이름과 소유자 */
export function listAllRepositoryNames(db: DatabaseSync): { fullName: string; owner: string }[] {
  return db
    .prepare('SELECT full_name, owner FROM cache_repositories')
    .all()
    .map((row) => ({ fullName: str(row, 'full_name'), owner: str(row, 'owner') }))
}

/** 수집기가 쓰는 저장소 참조(노드 ID·이름·열린 수) */
export interface RepositoryRef {
  id: number
  nodeId: string | null
  fullName: string
  openPullRequestCount: number
  openIssueCount: number
}

function toRef(row: Row): RepositoryRef {
  return {
    id: num(row, 'id'),
    nodeId: strOrNull(row, 'node_id'),
    fullName: str(row, 'full_name'),
    openPullRequestCount: num(row, 'open_pr_count'),
    openIssueCount: num(row, 'open_issue_count')
  }
}

const REF_SELECT =
  'SELECT id, node_id, full_name, open_pr_count, open_issue_count FROM cache_repositories'

/** 주어진 ID 의 참조. 캐시에 없는 ID 는 빠진다. 순서는 ids 순 */
export function getRepositoryRefs(db: DatabaseSync, ids: readonly number[]): RepositoryRef[] {
  if (ids.length === 0) return []
  const byId = new Map(
    db
      .prepare(`${REF_SELECT} WHERE id IN (${placeholders(ids.length)})`)
      .all(...ids)
      .map((row) => [num(row, 'id'), toRef(row)])
  )
  return ids.flatMap((id) => byId.get(id) ?? [])
}

/** 내 저장소 집합 전체의 참조(포크·보관 포함). 들어온 PR·이슈 수집 대상 */
export function listMyRepositoryRefs(db: DatabaseSync): RepositoryRef[] {
  return db.prepare(`${REF_SELECT} WHERE is_mine = 1 ORDER BY id`).all().map(toRef)
}

/**
 * 접근 불가(삭제·권한 상실·404)로 표시한다. 캐시에 행이 없으면(로그아웃 뒤 고정만 남은 경우)
 * 이름이 빈 자리 행을 만들어 고정 표시가 unavailable 을 알 수 있게 한다. 고정·연결은 건드리지 않는다.
 */
export function markRepositoryUnavailable(
  db: DatabaseSync,
  repoId: number,
  now: number = Date.now()
): void {
  db.prepare(
    `INSERT INTO cache_repositories (id, owner, name, full_name, url, access_status, synced_at)
     VALUES (?, '', '', '', '', 'unavailable', ?)
     ON CONFLICT (id) DO UPDATE SET access_status = 'unavailable'`
  ).run(repoId, now)
}

const SORTS = {
  pushed: 'pushed_at IS NULL, pushed_at DESC, full_name COLLATE NOCASE ASC',
  name: 'name COLLATE NOCASE ASC, full_name COLLATE NOCASE ASC',
  stars: 'stargazer_count DESC, full_name COLLATE NOCASE ASC'
} as const

/** 내 저장소 집합 (spec §4.8). 포크·보관은 기본으로 숨긴다. 정렬 기본은 최근 푸시 */
export function listMyRepositories(
  db: DatabaseSync,
  options: RepoListOptions = {}
): RepositorySummary[] {
  const where = ['is_mine = 1']
  const params: (string | number)[] = []
  if (!options.includeForks) where.push('fork = 0')
  if (!options.includeArchived) where.push('archived = 0')
  if (options.owner) {
    where.push('owner = ? COLLATE NOCASE')
    params.push(options.owner)
  }
  const search = options.search?.trim()
  if (search) {
    where.push("(full_name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')")
    params.push(likePattern(search), likePattern(search))
  }
  const order = SORTS[options.sort ?? 'pushed'] ?? SORTS.pushed
  const limit =
    options.limit !== undefined && options.limit > 0 ? ` LIMIT ${Math.floor(options.limit)}` : ''
  return db
    .prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}${limit}`)
    .all(...params)
    .map(toRepositorySummary)
}

export interface RepoOwnerSummary {
  login: string
  type: RepoOwnerType
  count: number
}

/** Repositories 화면의 소유자 필터 목록 */
export function listMyRepositoryOwners(db: DatabaseSync): RepoOwnerSummary[] {
  return db
    .prepare(
      `SELECT owner, MAX(owner_type) AS owner_type, COUNT(*) AS n FROM cache_repositories
       WHERE is_mine = 1 GROUP BY owner ORDER BY owner COLLATE NOCASE`
    )
    .all()
    .map((row) => ({
      login: str(row, 'owner'),
      type: str(row, 'owner_type') === 'Organization' ? 'Organization' : 'User',
      count: num(row, 'n')
    }))
}

/** 스타한 저장소 (spec §4.7), 스타한 시각 최신 순 */
export function listStarredRepositories(
  db: DatabaseSync,
  options: { search?: string; limit?: number } = {}
): RepositorySummary[] {
  const where = ['viewer_has_starred = 1']
  const params: string[] = []
  const search = options.search?.trim()
  if (search) {
    where.push("(full_name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')")
    params.push(likePattern(search), likePattern(search))
  }
  const limit =
    options.limit !== undefined && options.limit > 0 ? ` LIMIT ${Math.floor(options.limit)}` : ''
  return db
    .prepare(
      `${SELECT} WHERE ${where.join(' AND ')}
       ORDER BY starred_at IS NULL, starred_at DESC, full_name COLLATE NOCASE${limit}`
    )
    .all(...params)
    .map(toRepositorySummary)
}

/** 스타 낙관적 갱신의 되돌리기용 이전 값 */
export interface StarSnapshot {
  repoId: number
  viewerHasStarred: boolean
  starredAt: string | null
  stargazerCount: number
}

/**
 * 스타·스타 취소를 캐시에 바로 반영한다(쓰기 동작 서비스가 요청 전에 부른다).
 * 상태가 바뀌면 스타 수를 ±1 한다. 이전 값을 돌려주며 실패하면 restoreStarred 로 되돌린다.
 * 캐시에 없는 저장소면 null.
 */
export function setStarred(
  db: DatabaseSync,
  repoId: number,
  starred: boolean,
  now: number = Date.now()
): StarSnapshot | null {
  return withTransaction(db, () => {
    const row = db
      .prepare(
        'SELECT viewer_has_starred, starred_at, stargazer_count FROM cache_repositories WHERE id = ?'
      )
      .get(repoId)
    if (row === undefined) return null
    const prev: StarSnapshot = {
      repoId,
      viewerHasStarred: bool(row, 'viewer_has_starred'),
      starredAt: strOrNull(row, 'starred_at'),
      stargazerCount: num(row, 'stargazer_count')
    }
    if (prev.viewerHasStarred === starred) return prev
    db.prepare(
      `UPDATE cache_repositories SET viewer_has_starred = ?, starred_at = ?,
         stargazer_count = MAX(0, stargazer_count + ?) WHERE id = ?`
    ).run(sqlBool(starred), starred ? new Date(now).toISOString() : null, starred ? 1 : -1, repoId)
    return prev
  })
}

/** setStarred 가 돌려준 이전 값으로 되돌린다 */
export function restoreStarred(db: DatabaseSync, snapshot: StarSnapshot): void {
  db.prepare(
    `UPDATE cache_repositories SET viewer_has_starred = ?, starred_at = ?, stargazer_count = ?
     WHERE id = ?`
  ).run(
    sqlBool(snapshot.viewerHasStarred),
    snapshot.starredAt,
    snapshot.stargazerCount,
    snapshot.repoId
  )
}
