// GitHub 원격 주소 해석과 작업 폴더의 원격 읽기(spec 4.11).
import { realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runGit } from './runner'
import type { GitExec } from './runner'

export interface GitHubRepoRef {
  owner: string
  name: string
}

export interface GitHubRemote {
  /** 원격 이름. 예: origin, upstream */
  name: string
  /** git 에 설정된 주소 그대로 */
  url: string
  /** github.com 저장소면 해석 결과, 아니면 null */
  repo: GitHubRepoRef | null
}

const GITHUB_HOST = 'github.com'
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/
/** scp 형식: [user@]host:path (스킴 없음) */
const SCP_LIKE = /^(?:[^@/:\s]+@)?([^@/:\s]+):(?!\/\/)(.+)$/

/** GitHub 저장소 소유자 이름으로 쓸 수 있는지. */
export function isValidOwner(owner: string): boolean {
  return OWNER_PATTERN.test(owner)
}

/** GitHub 저장소 이름으로 쓸 수 있는지. "." 과 ".." 은 안 된다. */
export function isValidRepoName(name: string): boolean {
  return NAME_PATTERN.test(name) && name !== '.' && name !== '..'
}

/**
 * github.com 저장소를 가리키는 원격 주소면 { owner, name } 을, 아니면 null 을 돌려준다.
 * https://github.com/o/n(.git)(/), https://user@github.com/o/n, git@github.com:o/n(.git),
 * ssh://git@github.com/o/n(.git) 을 받는다. 호스트는 대소문자를 가리지 않는다.
 */
export function parseGitHubRemote(url: string): GitHubRepoRef | null {
  const raw = url.trim()
  if (raw === '') return null

  if (!raw.includes('://')) {
    const scp = SCP_LIKE.exec(raw)
    if (!scp) return null
    const [, host, path] = scp
    if (host === undefined || path === undefined) return null
    if (host.toLowerCase() !== GITHUB_HOST) return null
    return parseRepoPath(path)
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (!['https:', 'http:', 'ssh:'].includes(parsed.protocol)) return null
  if (parsed.hostname.toLowerCase() !== GITHUB_HOST) return null
  if (parsed.search !== '' || parsed.hash !== '') return null
  return parseRepoPath(parsed.pathname)
}

function parseRepoPath(path: string): GitHubRepoRef | null {
  const trimmed = path.replace(/^\/+/, '').replace(/\/+$/, '')
  const segments = trimmed.split('/')
  if (segments.length !== 2) return null
  const [owner, rawName] = segments
  if (owner === undefined || rawName === undefined) return null
  const name = rawName.endsWith('.git') ? rawName.slice(0, -'.git'.length) : rawName
  if (!isValidOwner(owner) || !isValidRepoName(name)) return null
  return { owner, name }
}

/**
 * dir 이 git 작업 폴더의 최상위면 그 원격들을 해석해서 돌려준다(origin, upstream 먼저).
 * git 저장소가 아니거나, 다른 저장소의 하위 폴더이거나, 읽을 수 없으면 null.
 */
export async function readGitHubRemotes(
  dir: string,
  options: { exec?: GitExec } = {}
): Promise<GitHubRemote[] | null> {
  try {
    const info = await stat(dir)
    if (!info.isDirectory()) return null

    const top = await runGit(['rev-parse', '--show-toplevel'], dir, options)
    if (top.kind !== 'done' || top.exitCode !== 0) return null
    // 상위 폴더의 저장소를 이 폴더의 것으로 착각하지 않는다.
    if (!(await samePath(top.stdout.trim(), dir))) return null

    const listed = await runGit(['remote', '-v'], dir, options)
    if (listed.kind !== 'done' || listed.exitCode !== 0) return null
    return sortRemotes(parseRemoteList(listed.stdout))
  } catch {
    return null
  }
}

async function samePath(a: string, b: string): Promise<boolean> {
  const [ra, rb] = await Promise.all([realpath(resolve(a)), realpath(resolve(b))])
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb
}

/** `git remote -v` 출력("이름\t주소 (fetch)")을 원격 목록으로 바꾼다. fetch 주소를 우선한다. */
function parseRemoteList(output: string): GitHubRemote[] {
  const byName = new Map<string, { url: string; fetch: boolean }>()
  for (const line of output.split(/\r?\n/)) {
    const match = /^(\S+)\t(.+?)\s+\((fetch|push)\)$/.exec(line)
    if (!match) continue
    const [, name, url, kind] = match
    if (name === undefined || url === undefined) continue
    const existing = byName.get(name)
    if (!existing || (!existing.fetch && kind === 'fetch')) {
      byName.set(name, { url, fetch: kind === 'fetch' })
    }
  }
  return [...byName].map(([name, { url }]) => ({ name, url, repo: parseGitHubRemote(url) }))
}

const PREFERRED_ORDER = ['origin', 'upstream']

function sortRemotes(remotes: GitHubRemote[]): GitHubRemote[] {
  const rank = (name: string) => {
    const i = PREFERRED_ORDER.indexOf(name)
    return i === -1 ? PREFERRED_ORDER.length : i
  }
  // Array.prototype.sort 는 안정 정렬이라 나머지는 git 이 준 순서를 유지한다.
  return [...remotes].sort((a, b) => rank(a.name) - rank(b.name))
}
