// 내장 git 으로 GitHub 저장소를 클론한다(spec 4.10).
// - HTTPS: 토큰은 그 git 명령의 환경 변수로만 전달하고(askpass), 인자·원격 주소·.git/config 에 남기지 않는다.
// - SSH: 사용자의 SSH 설정과 키를 그대로 쓴다.
// - 실패·취소 시 이번 호출이 만든 폴더만 지운다.
import type { Dirent } from 'node:fs'
import { lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { createAskpass } from './askpass'
import type { AskpassHelper } from './askpass'
import { isValidOwner, isValidRepoName, readGitHubRemotes } from './remote'
import type { GitHubRemote } from './remote'
import { parseProgressLine, runGit } from './runner'
import type { GitExec, GitProgress } from './runner'

export type CloneProtocol = 'https' | 'ssh'
export type CloneProgress = GitProgress

export interface CloneOptions {
  owner: string
  name: string
  /** 클론할 폴더의 절대 경로. 없거나 빈 폴더여야 클론한다. */
  targetDir: string
  protocol: CloneProtocol
  /** HTTPS 에서만 쓰는 GitHub 토큰. 이 클론 명령 동안에만 전달된다. */
  token?: string
  onProgress?: (progress: CloneProgress) => void
  signal?: AbortSignal
}

export interface CloneDeps {
  /** git 실행 함수(테스트용). 기본은 dugite. */
  exec?: GitExec
  /** 실제로 받아 올 주소(테스트용). 기본은 GitHub 의 표준 주소. 클론 뒤 원격 주소는 항상 표준 주소로 맞춘다. */
  sourceUrl?: string
}

export type CloneResult =
  | { kind: 'cloned'; path: string }
  /** 대상이 이미 있다(파일 또는 비어 있지 않은 폴더). git 폴더면 그 원격들, 아니면 빈 배열. */
  | { kind: 'exists'; remotes: GitHubRemote[] }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string }

/** 결과 폴더의 원격 주소. 사용자가 터미널 git 으로 그대로 쓸 수 있는 평범한 주소. */
export function githubRemoteUrl(owner: string, name: string, protocol: CloneProtocol): string {
  return protocol === 'ssh'
    ? `git@github.com:${owner}/${name}.git`
    : `https://github.com/${owner}/${name}.git`
}

const REDACTED = '***'

export async function cloneRepository(
  options: CloneOptions,
  deps: CloneDeps = {}
): Promise<CloneResult> {
  const { owner, name, protocol, token, onProgress, signal } = options
  const { exec } = deps
  const redact = (text: string) => (token ? text.split(token).join(REDACTED) : text)
  const failed = (message: string): CloneResult => ({ kind: 'failed', message: redact(message) })

  if (!isValidOwner(owner) || !isValidRepoName(name)) {
    return failed(`Invalid repository name: ${owner}/${name}`)
  }
  if (!isAbsolute(options.targetDir)) {
    return failed('Target folder must be an absolute path')
  }
  const target = resolve(options.targetDir)
  if (dirname(target) === target) {
    return failed('Target folder cannot be a filesystem root')
  }
  if (signal?.aborted) return { kind: 'cancelled' }

  let prepared: PreparedTarget
  try {
    prepared = await prepareTarget(target)
  } catch (error) {
    return failed(`Cannot prepare target folder: ${errorMessage(error)}`)
  }
  if (prepared.kind === 'exists') {
    return { kind: 'exists', remotes: (await readGitHubRemotes(target, { exec })) ?? [] }
  }

  // 이번 호출이 만든 폴더만 지운다. 원래 있던 (빈) 폴더와 대상 밖은 절대 건드리지 않는다.
  const cleanup = async () => {
    if (!prepared.created) return
    await rm(target, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
  }

  let askpass: AskpassHelper | undefined
  try {
    const useToken = protocol === 'https' && token !== undefined && token !== ''
    if (useToken) askpass = await createAskpass(token)

    const source = deps.sourceUrl ?? githubRemoteUrl(owner, name, protocol)
    const args = [
      // 사용자의 자격 증명 도우미(osxkeychain, manager 등)가 토큰을 저장하지 못하게 비운다.
      ...(askpass ? ['-c', 'credential.helper='] : []),
      'clone',
      '--progress',
      '--',
      source,
      target
    ]
    const run = await runGit(args, dirname(target), {
      exec,
      signal,
      env: askpass ? askpass.env : { GIT_TERMINAL_PROMPT: '0' },
      onStderrLine: (line) => {
        const progress = parseProgressLine(line)
        if (progress && onProgress) {
          try {
            onProgress(progress)
          } catch {
            // 진행률 표시 오류가 클론을 망가뜨리지 않게 한다.
          }
        }
      }
    })
    if (run.kind === 'cancelled') {
      await cleanup()
      return { kind: 'cancelled' }
    }
    if (run.exitCode !== 0) {
      await cleanup()
      return failed(summarizeStderr(run.stderr, run.exitCode))
    }

    // 원격 주소를 표준 주소로 맞춘다(테스트용 sourceUrl, 리다이렉트 등).
    const setUrl = await runGit(
      ['remote', 'set-url', 'origin', githubRemoteUrl(owner, name, protocol)],
      target,
      { exec, signal }
    )
    if (setUrl.kind === 'cancelled') {
      await cleanup()
      return { kind: 'cancelled' }
    }
    if (setUrl.exitCode !== 0) {
      await cleanup()
      return failed(summarizeStderr(setUrl.stderr, setUrl.exitCode))
    }

    // 방어: 어떤 경로로든 토큰이 설정 파일에 남았으면 결과 폴더를 쓰지 않는다.
    if (token) {
      const config = await readFile(join(target, '.git', 'config'), 'utf8')
      if (config.includes(token)) {
        await cleanup()
        return failed('Clone aborted: credentials were found in the repository configuration')
      }
    }
    return { kind: 'cloned', path: target }
  } catch (error) {
    await cleanup()
    return failed(`git clone failed: ${errorMessage(error)}`)
  } finally {
    await askpass?.dispose().catch(() => undefined)
  }
}

type PreparedTarget = { kind: 'exists' } | { kind: 'ready'; created: boolean }

/**
 * 대상 경로를 살핀다. 파일·심볼릭 링크·비어 있지 않은 폴더면 exists.
 * 없으면 직접 만들어서(원자적 mkdir) "이번 호출이 만들었다"를 확실히 한다.
 */
async function prepareTarget(target: string, attempt = 0): Promise<PreparedTarget> {
  try {
    const info = await lstat(target)
    if (!info.isDirectory()) return { kind: 'exists' }
    const entries: Dirent[] = await readdir(target, { withFileTypes: true })
    return entries.length === 0 ? { kind: 'ready', created: false } : { kind: 'exists' }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
  await mkdir(dirname(target), { recursive: true })
  try {
    await mkdir(target)
    return { kind: 'ready', created: true }
  } catch (error) {
    // 확인과 생성 사이에 누가 만들었다면 그 폴더는 우리 것이 아니다. 다시 살핀다.
    if (errorCode(error) === 'EEXIST' && attempt === 0) return prepareTarget(target, 1)
    throw error
  }
}

/** git 오류 출력에서 사용자에게 보일 줄(fatal/error 등)을 고른다. */
function summarizeStderr(stderr: string, exitCode: number): string {
  const lines = stderr
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && parseProgressLine(l) === null)
  const important = lines.filter((l) => /^(fatal|error|remote: error|ERROR)[:\s]/i.test(l))
  const chosen = important.length > 0 ? important : lines.slice(-3)
  return chosen.length > 0 ? chosen.join('\n') : `git exited with code ${exitCode}`
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
