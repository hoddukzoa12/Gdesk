// 로컬 폴더 연결·클론·열기 서비스(spec 4.10, 4.11). Electron 을 import 하지 않는다.
// 바깥 의존성(DB·설정·git·GitHub·세션·실행기)은 LocalDeps 로 주입한다.
import { stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { ConnectionStatus } from '@shared/domain/connection'
import type { LocalLink } from '@shared/domain/link'
import type {
  CloneFailureCode,
  CloneOutcome,
  CloneProgressEvent,
  CloneRequest,
  EditorInfo,
  LinkOutcome,
  LinkRequest,
  LocalRemote,
  OpenOutcome,
  OpenRequest,
  ScanSummary
} from '@shared/domain/local'
import type { SessionState } from '@shared/domain/session'
import type { Settings } from '@shared/domain/settings'
import { getRepository } from '../cache'
import {
  addLink,
  findLink,
  getLink,
  listAllLinks,
  listLinksByRepo,
  removeLink,
  setLinkStatus,
  touchLink
} from '../db/links'
import type { PathOptions } from '../db/links'
import { withTransaction } from '../db/transaction'
import type { CloneOptions, CloneResult, GitHubRemote, GitHubRepoRef } from '../git'
import { detectEditors, findOnPath } from './editors'
import type { DetectEnv, DetectedEditor } from './editors'
import { terminalCommand } from './launch'
import type { LaunchCommand, Launcher } from './launch'
import { DEFAULT_SCAN_DEPTH, findGitWorkingCopies } from './scan'

export interface LocalDeps {
  db: () => DatabaseSync
  settings: () => Settings
  /** 작업 폴더 최상위의 원격들. git 폴더가 아니면 null (기본: readGitHubRemotes) */
  readRemotes: (dir: string) => Promise<GitHubRemote[] | null>
  /** 기본: cloneRepository */
  clone: (options: CloneOptions) => Promise<CloneResult>
  sessionState: () => SessionState
  connectionStatus: () => ConnectionStatus
  /**
   * `GET /repos/{owner}/{name}` 으로 저장소 ID 를 찾는다(이름이 바뀌었으면 GitHub 이 리다이렉트).
   * 없거나 실패하면 null. 로그인·온라인일 때만 부른다.
   */
  lookupRepo: (owner: string, name: string) => Promise<number | null>
  /** 메인 전용 토큰. HTTPS 클론에만 넘긴다 */
  token: () => string | null
  notify: (keys: string[]) => void
  onCloneProgress: (event: CloneProgressEvent) => void
  launcher: Launcher
  detect: DetectEnv
  /** 자동 찾기 깊이(기본 2) */
  scanDepth?: number
  pathOptions?: PathOptions
  now?: () => number
}

const SCAN_REMOTES = ['origin', 'upstream']
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/
const REDACTED = '***'

type Match = 'match' | 'mismatch' | 'unknown'

/** 한 번의 작업(찾기·연결) 동안 owner/name → ID 풀이를 기억한다. */
type ResolveMemo = Map<string, Promise<number | null>>

function refKey(ref: GitHubRepoRef): string {
  return `${ref.owner}/${ref.name}`.toLowerCase()
}

function sameRef(a: GitHubRepoRef, b: GitHubRepoRef): boolean {
  return refKey(a) === refKey(b)
}

function uniqueRefs(refs: GitHubRepoRef[]): GitHubRepoRef[] {
  const seen = new Set<string>()
  return refs.filter((r) => {
    const key = refKey(r)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 자동 찾기용: origin·upstream 의 GitHub 저장소 */
function scanRefs(remotes: readonly GitHubRemote[]): GitHubRepoRef[] {
  return uniqueRefs(
    remotes.flatMap((r) => (SCAN_REMOTES.includes(r.name) && r.repo ? [r.repo] : []))
  )
}

/** 비교용: origin·upstream 이 있으면 그것, 없으면 모든 GitHub 원격 */
function matchRefs(remotes: readonly GitHubRemote[]): GitHubRepoRef[] {
  const preferred = scanRefs(remotes)
  if (preferred.length > 0) return preferred
  return uniqueRefs(remotes.flatMap((r) => (r.repo ? [r.repo] : [])))
}

/** 원격 주소의 사용자 정보(user:토큰@)를 지운다. 화면으로 보내기 전에 쓴다 */
export function stripUrlCredentials(url: string): string {
  if (!url.includes('://')) return url // scp 형식(git@host:o/n)은 비밀을 담지 않는다
  try {
    const parsed = new URL(url)
    if (parsed.username === '' && parsed.password === '') return url
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch {
    return url.replace(/\/\/[^/@]*@/, '//')
  }
}

function toLocalRemote(remote: GitHubRemote, redact: (text: string) => string): LocalRemote {
  return {
    name: remote.name,
    url: redact(stripUrlCredentials(remote.url)),
    repo: remote.repo ? { owner: remote.repo.owner, name: remote.repo.name } : null
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** git 오류 문장을 화면이 번역할 코드로 나눈다. */
export function classifyCloneFailure(message: string): CloneFailureCode {
  if (/^Invalid repository name/i.test(message)) return 'invalid_request'
  if (/^Target folder/i.test(message)) return 'invalid_target'
  if (/^Cannot prepare target folder|No space left/i.test(message)) return 'target_error'
  if (/Permission denied \(publickey|Host key verification failed/i.test(message)) {
    return 'ssh_auth'
  }
  if (
    /Authentication failed|could not read (Username|Password)|returned error: 40[13]/i.test(message)
  ) {
    return 'auth_failed'
  }
  if (/Repository not found|not found|does not appear to be a git repository/i.test(message)) {
    return 'not_found'
  }
  if (
    /Could not resolve host|unable to access|Failed to connect|Connection (refused|reset|timed out)|timed out|Network is unreachable/i.test(
      message
    )
  ) {
    return 'network'
  }
  return 'git_error'
}

export class LocalService {
  private readonly active = new Map<string, AbortController>()
  /** 클론 중인 대상 폴더. 자동 찾기가 반쯤 받은 폴더를 연결하지 않게 한다 */
  private readonly cloningTargets = new Set<string>()
  private running: Promise<ScanSummary> | null = null
  private queued: Promise<ScanSummary> | null = null

  constructor(private readonly deps: LocalDeps) {}

  private get db(): DatabaseSync {
    return this.deps.db()
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private notifyRepos(repoIds: Iterable<number>): void {
    const keys = [...new Set(repoIds)].map((id) => `repo:${id}`)
    if (keys.length > 0) this.deps.notify([...keys, 'sidebar'])
  }

  private canUseApi(): boolean {
    return this.deps.sessionState() === 'signed_in' && this.deps.connectionStatus() === 'online'
  }

  // ───────────── 저장소 풀이 ─────────────

  /** 캐시의 owner/name → ID (대소문자 무시). 캐시 모듈에 이 조회가 없어 여기서 읽기만 한다 */
  private cachedRepoId(ref: GitHubRepoRef): number | null {
    const row = this.db
      .prepare(
        `SELECT id FROM cache_repositories
         WHERE owner = ? COLLATE NOCASE AND name = ? COLLATE NOCASE
         ORDER BY access_status = 'available' DESC, id LIMIT 1`
      )
      .get(ref.owner, ref.name)
    return row === undefined ? null : Number(row.id)
  }

  /** 캐시 → (로그인·온라인이면) GitHub 조회. 풀 수 없으면 null */
  private resolveRef(ref: GitHubRepoRef, memo: ResolveMemo): Promise<number | null> {
    const key = refKey(ref)
    const known = memo.get(key)
    if (known) return known
    const task = (async () => {
      const cached = this.cachedRepoId(ref)
      if (cached !== null) return cached
      if (!this.canUseApi()) return null
      try {
        const id = await this.deps.lookupRepo(ref.owner, ref.name)
        return id !== null && Number.isSafeInteger(id) && id > 0 ? id : null
      } catch {
        return null
      }
    })()
    memo.set(key, task)
    return task
  }

  /**
   * 원격들이 repoId 저장소를 가리키는지. 요청한 이름·캐시의 현재 이름과 먼저 비교하고(대소문자 무시),
   * 아니면 ID 로 풀어 비교한다. 하나라도 풀지 못했고 맞는 것도 없으면 unknown.
   */
  private async matchRepo(
    refs: readonly GitHubRepoRef[],
    repoId: number,
    memo: ResolveMemo,
    names: readonly GitHubRepoRef[] = []
  ): Promise<Match> {
    const current = getRepository(this.db, repoId)
    const known = [...names, ...(current && current.owner ? [current] : [])]
    if (refs.some((ref) => known.some((name) => sameRef(ref, name)))) return 'match'
    let unknown = false
    for (const ref of refs) {
      const id = await this.resolveRef(ref, memo)
      if (id === repoId) return 'match'
      if (id === null) unknown = true
    }
    return unknown ? 'unknown' : 'mismatch'
  }

  // ───────────── 목록 ─────────────

  listLinks(request: { repoId?: number } = {}): LocalLink[] {
    return request.repoId === undefined
      ? listAllLinks(this.db)
      : listLinksByRepo(this.db, request.repoId)
  }

  listEditors(): EditorInfo[] {
    return detectEditors(this.deps.detect).map(({ id, name }) => ({ id, name }))
  }

  // ───────────── 클론 ─────────────

  private gate(): CloneFailureCode | null {
    const session = this.deps.sessionState()
    if (session === 'expired') return 'session_expired'
    if (session !== 'signed_in') return 'signed_out'
    const status = this.deps.connectionStatus()
    if (status === 'online') return null
    if (status === 'session_expired') return 'session_expired'
    if (status === 'rate_limited') return 'rate_limited'
    return 'offline'
  }

  async clone(request: CloneRequest): Promise<CloneOutcome> {
    const failed = (code: CloneFailureCode, detail = ''): CloneOutcome => ({
      kind: 'failed',
      code,
      detail
    })
    const { cloneId, repoId, owner, name } = request ?? ({} as CloneRequest)
    if (
      typeof cloneId !== 'string' ||
      cloneId === '' ||
      !Number.isSafeInteger(repoId) ||
      repoId <= 0 ||
      typeof owner !== 'string' ||
      !OWNER_PATTERN.test(owner) ||
      typeof name !== 'string' ||
      !NAME_PATTERN.test(name) ||
      name === '.' ||
      name === '..'
    ) {
      return failed('invalid_request', 'Invalid clone request')
    }
    if (this.active.has(cloneId)) return failed('already_running', 'Clone is already running')

    const gated = this.gate()
    if (gated !== null) return failed(gated)

    const settings = this.deps.settings()
    const targetDir = request.targetDir ?? join(settings.cloneBaseDir, name)
    if (typeof targetDir !== 'string' || !isAbsolute(targetDir)) {
      return failed('invalid_target', 'Target folder must be an absolute path')
    }

    const protocol = settings.cloneProtocol
    let token: string | undefined
    if (protocol === 'https') {
      token = this.deps.token() ?? undefined
      if (!token) return failed('signed_out')
    }
    const redact = (text: string) => (token ? text.split(token).join(REDACTED) : text)

    const controller = new AbortController()
    const targetKey = resolve(targetDir)
    this.active.set(cloneId, controller)
    this.cloningTargets.add(targetKey)
    let result: CloneResult
    try {
      result = await this.deps.clone({
        owner,
        name,
        targetDir,
        protocol,
        token,
        signal: controller.signal,
        onProgress: ({ phase, percent }) => this.deps.onCloneProgress({ cloneId, phase, percent })
      })
    } catch (error) {
      result = { kind: 'failed', message: errorMessage(error) }
    } finally {
      this.active.delete(cloneId)
      this.cloningTargets.delete(targetKey)
    }

    switch (result.kind) {
      case 'cloned': {
        const { link } = addLink(this.db, repoId, result.path, {
          ...this.deps.pathOptions,
          now: this.now()
        })
        if (link.status !== 'ok') setLinkStatus(this.db, link.id, 'ok')
        this.notifyRepos([repoId])
        return { kind: 'cloned', path: result.path, link: getLink(this.db, link.id) ?? link }
      }
      case 'exists': {
        const match = await this.matchRepo(matchRefs(result.remotes), repoId, new Map(), [
          { owner, name }
        ])
        return {
          kind: 'exists',
          path: targetDir,
          remotes: result.remotes.map((r) => toLocalRemote(r, redact)),
          sameRepo: match === 'match'
        }
      }
      case 'cancelled':
        return { kind: 'cancelled' }
      case 'failed': {
        const detail = redact(result.message)
        return failed(classifyCloneFailure(detail), detail)
      }
    }
  }

  cancelClone(request: { cloneId: string }): { cancelled: boolean } {
    const controller = this.active.get(request?.cloneId)
    if (!controller) return { cancelled: false }
    controller.abort()
    return { cancelled: true }
  }

  // ───────────── 자동 찾기 ─────────────

  /** 클론 기본 폴더를 훑어 연결을 더하고 기존 연결을 다시 확인한다. 겹친 요청은 합친다. */
  rescan(): Promise<ScanSummary> {
    if (this.queued) return this.queued
    if (this.running) {
      const next = this.running
        .catch(() => undefined)
        .then(() => {
          this.queued = null
          return this.startScan()
        })
      this.queued = next
      return next
    }
    return this.startScan()
  }

  private startScan(): Promise<ScanSummary> {
    const run = this.scan().finally(() => {
      if (this.running === run) this.running = null
    })
    this.running = run
    return run
  }

  private async scan(): Promise<ScanSummary> {
    const memo: ResolveMemo = new Map()
    const affected = new Set<number>()
    const fresh = new Set<number>()
    let found = 0
    let added = 0

    const base = this.deps.settings().cloneBaseDir
    const dirs = await findGitWorkingCopies(base, {
      maxDepth: this.deps.scanDepth ?? DEFAULT_SCAN_DEPTH
    })
    for (const dir of dirs) {
      if (this.cloningTargets.has(resolve(dir))) continue
      const remotes = await this.deps.readRemotes(dir)
      if (remotes === null) continue
      found++
      const ids = new Set<number>()
      for (const ref of scanRefs(remotes)) {
        const id = await this.resolveRef(ref, memo)
        if (id !== null) ids.add(id)
      }
      for (const id of ids) {
        const { link, created } = addLink(this.db, id, dir, {
          ...this.deps.pathOptions,
          now: this.now()
        })
        if (created) {
          added++
          affected.add(id)
          fresh.add(link.id)
        }
      }
    }

    let missing = 0
    for (const link of listAllLinks(this.db)) {
      if (fresh.has(link.id)) continue
      const status = await this.checkLink(link, memo)
      if (status !== link.status) {
        setLinkStatus(this.db, link.id, status)
        affected.add(link.repoId)
      }
      if (status === 'missing') missing++
    }

    this.notifyRepos(affected)
    return { found, added, missing }
  }

  /** 폴더가 없거나 git 폴더가 아니거나 다른 저장소면 missing. 확인할 수 없으면 지금 상태를 둔다 */
  private async checkLink(link: LocalLink, memo: ResolveMemo): Promise<LocalLink['status']> {
    const remotes = await this.deps.readRemotes(link.path)
    if (remotes === null) return 'missing'
    const refs = matchRefs(remotes)
    if (refs.length === 0) return 'missing'
    const match = await this.matchRepo(refs, link.repoId, memo)
    if (match === 'match') return 'ok'
    if (match === 'mismatch') return 'missing'
    return link.status
  }

  // ───────────── 직접 연결 ─────────────

  /** 폴더를 검사해 연결할 저장소 ID 들을 고른다 */
  private async validateFolder(
    path: unknown,
    repoId: number | undefined
  ): Promise<{ ok: true; repoIds: number[] } | Extract<LinkOutcome, { ok: false }>> {
    if (typeof path !== 'string' || path.trim() === '' || !isAbsolute(path)) {
      return { ok: false, reason: 'path_not_found' }
    }
    if (!(await isDirectory(path))) return { ok: false, reason: 'path_not_found' }
    const remotes = await this.deps.readRemotes(path)
    if (remotes === null) return { ok: false, reason: 'not_git' }
    const refs = matchRefs(remotes)
    if (refs.length === 0) return { ok: false, reason: 'not_github' }
    const memo: ResolveMemo = new Map()

    if (repoId !== undefined) {
      const match = await this.matchRepo(refs, repoId, memo)
      if (match === 'mismatch') return { ok: false, reason: 'different_repo' }
      if (match === 'unknown') return { ok: false, reason: 'unresolved' }
      return { ok: true, repoIds: [repoId] }
    }
    const ids = new Set<number>()
    for (const ref of refs) {
      const id = await this.resolveRef(ref, memo)
      if (id !== null) ids.add(id)
    }
    if (ids.size === 0) return { ok: false, reason: 'unresolved' }
    return { ok: true, repoIds: [...ids] }
  }

  async link(request: LinkRequest): Promise<LinkOutcome> {
    const repoId = request?.repoId
    if (repoId !== undefined && (!Number.isSafeInteger(repoId) || repoId <= 0)) {
      return { ok: false, reason: 'different_repo' }
    }
    const checked = await this.validateFolder(request?.path, repoId)
    if (!checked.ok) return checked
    const now = this.now()
    const links = withTransaction(this.db, () =>
      checked.repoIds.map((id) => {
        const { link } = addLink(this.db, id, request.path, { ...this.deps.pathOptions, now })
        if (link.status !== 'ok') setLinkStatus(this.db, link.id, 'ok')
        return getLink(this.db, link.id) ?? link
      })
    )
    this.notifyRepos(checked.repoIds)
    return { ok: true, links }
  }

  /** 연결(DB 행)만 지운다. 폴더는 절대 건드리지 않는다 */
  unlink(request: { linkId: number }): { removed: boolean } {
    const link = getLink(this.db, request?.linkId)
    if (!link) return { removed: false }
    const removed = removeLink(this.db, link.id)
    if (removed) this.notifyRepos([link.repoId])
    return { removed }
  }

  /** 연결을 새 경로로 옮긴다. 검사는 직접 연결과 같다. 연결 ID 가 바뀔 수 있다 */
  async relink(request: { linkId: number; path: string }): Promise<LinkOutcome> {
    const old = getLink(this.db, request?.linkId)
    if (!old) return { ok: false, reason: 'link_not_found' }
    const checked = await this.validateFolder(request.path, old.repoId)
    if (!checked.ok) return checked
    const now = this.now()
    const link = withTransaction(this.db, () => {
      const existing = findLink(this.db, old.repoId, request.path, this.deps.pathOptions)
      const target =
        existing ??
        addLink(this.db, old.repoId, request.path, { ...this.deps.pathOptions, now }).link
      if (target.id !== old.id) removeLink(this.db, old.id)
      setLinkStatus(this.db, target.id, 'ok')
      touchLink(this.db, target.id, now)
      return getLink(this.db, target.id) ?? target
    })
    this.notifyRepos([old.repoId])
    return { ok: true, links: [link] }
  }

  // ───────────── 열기 ─────────────

  private chooseEditor(
    editors: DetectedEditor[],
    editorId: string | undefined
  ): DetectedEditor | OpenOutcome {
    if (editors.length === 0) return { ok: false, reason: 'no_editor' }
    if (editorId !== undefined) {
      return editors.find((e) => e.id === editorId) ?? { ok: false, reason: 'unknown_editor' }
    }
    const preferred = this.deps.settings().defaultEditor
    return editors.find((e) => e.id === preferred) ?? (editors[0] as DetectedEditor)
  }

  async open(request: OpenRequest): Promise<OpenOutcome> {
    const link = getLink(this.db, request?.linkId)
    if (!link) return { ok: false, reason: 'link_not_found' }
    touchLink(this.db, link.id, this.now())

    if (!(await isDirectory(link.path))) {
      setLinkStatus(this.db, link.id, 'missing')
      this.notifyRepos([link.repoId])
      return { ok: false, reason: 'missing' }
    }

    const { launcher, detect } = this.deps
    let command: LaunchCommand
    switch (request.target) {
      case 'fileManager': {
        const error = await launcher.openPath(link.path).catch((e: unknown) => errorMessage(e))
        return error === '' ? { ok: true } : { ok: false, reason: 'launch_failed', detail: error }
      }
      case 'editor': {
        const chosen = this.chooseEditor(detectEditors(detect), request.editorId)
        if ('ok' in chosen) return chosen
        command = { command: chosen.command, args: [...chosen.args, link.path] }
        break
      }
      case 'terminal': {
        const terminal = terminalCommand(detect.platform, link.path, (name) =>
          findOnPath(name, detect)
        )
        if (terminal === null) return { ok: false, reason: 'no_terminal' }
        command = terminal
        break
      }
      default:
        return { ok: false, reason: 'launch_failed', detail: 'Unknown open target' }
    }
    try {
      await launcher.spawnDetached(command)
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: 'launch_failed', detail: errorMessage(error) }
    }
  }
}
