import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AppPlatform } from '@shared/domain/app'
import type { LocalLink, LocalLinkStatus } from '@shared/domain/link'

/**
 * 로컬 연결 저장소. (저장소 ID, 정규화한 경로) 쌍은 한 번만 저장한다.
 * 삭제는 DB 행만 지우며 폴더는 절대 지우지 않는다.
 */

export interface PathOptions {
  /** 대소문자 비교 방식을 정한다. 기본은 process.platform */
  platform?: NodeJS.Platform | AppPlatform
  /** 실제 경로 풀이(테스트 주입용). 기본은 fs.realpathSync.native */
  realpath?: (p: string) => string
}

export interface AddLinkOptions extends PathOptions {
  now?: number
}

export interface NormalizedPath {
  /** 보여 줄 경로 */
  path: string
  /** 중복 판정 키 */
  key: string
}

const STATUSES: readonly LocalLinkStatus[] = ['ok', 'missing']

function defaultRealpath(p: string): string {
  return realpathSync.native(p)
}

function isCaseInsensitive(platform: string): boolean {
  return platform === 'darwin' || platform === 'win32'
}

function stripTrailingSeparators(p: string, platform: string): string {
  const pattern = platform === 'win32' ? /[\\/]+$/ : /\/+$/
  const stripped = p.replace(pattern, '')
  if (stripped === '') return p.slice(0, 1) // 루트('/')
  if (platform === 'win32' && /^[A-Za-z]:$/.test(stripped)) return `${stripped}\\` // 드라이브 루트
  return stripped
}

/**
 * 경로를 정규화한다: 실제 경로로 풀고(심볼릭 링크 따라감, 없으면 절대 경로),
 * 끝 구분자를 떼고, macOS·Windows 에서는 대소문자를 무시한 키를 만든다.
 */
export function normalizeLinkPath(input: string, options: PathOptions = {}): NormalizedPath {
  const platform = options.platform ?? process.platform
  const realpath = options.realpath ?? defaultRealpath
  if (input.trim() === '') throw new Error('Link path is empty')
  const absolute = resolve(input)
  let real: string
  try {
    real = realpath(absolute)
  } catch {
    real = absolute
  }
  const path = stripTrailingSeparators(real, platform)
  const nfc = path.normalize('NFC')
  const key = isCaseInsensitive(platform) ? nfc.toLowerCase() : nfc
  return { path, key }
}

interface LinkRow {
  id: number
  repo_id: number
  path: string
  last_used_at: number
  status: string
}

function toLink(row: Record<string, unknown>): LocalLink {
  const r = row as unknown as LinkRow
  return {
    id: Number(r.id),
    repoId: Number(r.repo_id),
    path: String(r.path),
    lastUsedAt: Number(r.last_used_at),
    status: r.status === 'missing' ? 'missing' : 'ok'
  }
}

function assertRepoId(repoId: number): void {
  if (!Number.isSafeInteger(repoId) || repoId <= 0) {
    throw new Error(`Invalid repository id: ${repoId}`)
  }
}

const SELECT = 'SELECT id, repo_id, path, last_used_at, status FROM local_links'
const ORDER = 'ORDER BY last_used_at DESC, id ASC'

export function getLink(db: DatabaseSync, id: number): LocalLink | null {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id)
  return row === undefined ? null : toLink(row)
}

/** 저장소와 경로로 기존 연결을 찾는다(정규화 후 비교). */
export function findLink(
  db: DatabaseSync,
  repoId: number,
  inputPath: string,
  options: PathOptions = {}
): LocalLink | null {
  const { key } = normalizeLinkPath(inputPath, options)
  const row = db.prepare(`${SELECT} WHERE repo_id = ? AND path_key = ?`).get(repoId, key)
  return row === undefined ? null : toLink(row)
}

/**
 * 연결을 추가한다. 같은 (저장소, 정규화 경로) 가 이미 있으면 새로 만들지 않고 기존 연결을 돌려준다.
 * 새 연결은 status 'ok', lastUsedAt 은 추가 시각.
 */
export function addLink(
  db: DatabaseSync,
  repoId: number,
  inputPath: string,
  options: AddLinkOptions = {}
): { link: LocalLink; created: boolean } {
  assertRepoId(repoId)
  const { path, key } = normalizeLinkPath(inputPath, options)
  const now = options.now ?? Date.now()
  const result = db
    .prepare(
      `INSERT INTO local_links (repo_id, path, path_key, last_used_at, status)
       VALUES (?, ?, ?, ?, 'ok')
       ON CONFLICT (repo_id, path_key) DO NOTHING`
    )
    .run(repoId, path, key, now)
  const row = db.prepare(`${SELECT} WHERE repo_id = ? AND path_key = ?`).get(repoId, key)
  if (row === undefined) throw new Error('Failed to add local link')
  return { link: toLink(row), created: Number(result.changes) > 0 }
}

/** 연결(DB 행)만 지운다. 폴더는 건드리지 않는다. 지웠으면 true */
export function removeLink(db: DatabaseSync, id: number): boolean {
  return Number(db.prepare('DELETE FROM local_links WHERE id = ?').run(id).changes) > 0
}

export function listLinksByRepo(db: DatabaseSync, repoId: number): LocalLink[] {
  return db.prepare(`${SELECT} WHERE repo_id = ? ${ORDER}`).all(repoId).map(toLink)
}

export function listAllLinks(db: DatabaseSync): LocalLink[] {
  return db.prepare(`${SELECT} ${ORDER}`).all().map(toLink)
}

export function setLinkStatus(db: DatabaseSync, id: number, status: LocalLinkStatus): boolean {
  if (!STATUSES.includes(status)) throw new Error(`Invalid link status: ${String(status)}`)
  return (
    Number(db.prepare('UPDATE local_links SET status = ? WHERE id = ?').run(status, id).changes) > 0
  )
}

/** 마지막 사용 시각을 갱신한다. */
export function touchLink(db: DatabaseSync, id: number, now: number = Date.now()): boolean {
  return (
    Number(
      db.prepare('UPDATE local_links SET last_used_at = ? WHERE id = ?').run(now, id).changes
    ) > 0
  )
}
