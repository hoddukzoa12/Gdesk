import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { exec } from 'dugite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ASKPASS_TOKEN_ENV } from './askpass'
import { cloneRepository } from './clone'
import type { CloneProgress } from './clone'
import type { GitExec } from './runner'
import { git, isolateGitConfig, makeBareRepo } from './test-helpers'

const TOKEN = 'ghp_cloneTEST0123456789SECRET'

interface ExecCall {
  args: string[]
  env: Record<string, string | undefined>
}

/** 진짜 내장 git 을 부르되, 넘긴 인자와 환경 변수를 기록한다. */
function recordingExec(onSpawn?: () => void): { calls: ExecCall[]; fn: GitExec } {
  const calls: ExecCall[] = []
  const fn: GitExec = (args, path, options) => {
    calls.push({ args: [...args], env: { ...options?.env } })
    return exec(args, path, {
      ...options,
      processCallback: (cp) => {
        options?.processCallback?.(cp)
        onSpawn?.()
      }
    })
  }
  return { calls, fn }
}

/** 요청을 받기만 하고 영원히 답하지 않는 HTTP 서버. 진행 중 취소를 재현한다. */
async function startHangingServer(onRequest: () => void) {
  const server = createServer(() => onRequest())
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/o/n.git`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

let root: string
let sourceUrl: string
let work: string

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'gdesk-clone-test-')))
  isolateGitConfig(root)
  sourceUrl = pathToFileURL(await makeBareRepo(root)).href
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

let caseNo = 0
beforeEach(async () => {
  work = join(root, `case-${++caseNo}`)
  await mkdir(work)
  // 정리 범위 밖의 형제 파일. 어떤 경우에도 남아 있어야 한다.
  await writeFile(join(work, 'sibling.txt'), 'keep me')
})

afterEach(() => {
  expect(existsSync(join(work, 'sibling.txt'))).toBe(true)
})

describe('cloneRepository: HTTPS + 토큰', () => {
  it('클론하고, 원격 주소를 표준 https 로 맞추며, 토큰을 어디에도 남기지 않는다', async () => {
    const target = join(work, 'n')
    const rec = recordingExec()
    const progress: CloneProgress[] = []

    const result = await cloneRepository(
      {
        owner: 'o',
        name: 'n',
        targetDir: target,
        protocol: 'https',
        token: TOKEN,
        onProgress: (p) => progress.push(p)
      },
      { exec: rec.fn, sourceUrl }
    )

    expect(result).toEqual({ kind: 'cloned', path: target })
    expect(existsSync(join(target, 'a.txt'))).toBe(true)

    // 원격 주소는 정확히 표준 https 주소
    expect((await git(['remote', 'get-url', 'origin'], target)).trim()).toBe(
      'https://github.com/o/n.git'
    )

    // .git/config, git remote -v, git 인자 어디에도 토큰이 없다
    const config = await readFile(join(target, '.git', 'config'), 'utf8')
    expect(config).not.toContain(TOKEN)
    expect(config).not.toContain('x-access-token')
    expect(await git(['remote', '-v'], target)).not.toContain(TOKEN)
    expect(rec.calls.length).toBeGreaterThan(0)
    for (const call of rec.calls) {
      expect(call.args.join(' ')).not.toContain(TOKEN)
    }

    // 토큰은 클론 명령의 환경 변수로만 전달되고, 자격 증명 도우미는 꺼져 있다
    const cloneCall = rec.calls.find((c) => c.args.includes('clone'))
    expect(cloneCall).toBeDefined()
    expect(cloneCall?.args).toEqual(expect.arrayContaining(['-c', 'credential.helper=']))
    expect(cloneCall?.args).toContain('--progress')
    expect(cloneCall?.env[ASKPASS_TOKEN_ENV]).toBe(TOKEN)
    expect(cloneCall?.env.GIT_TERMINAL_PROMPT).toBe('0')
    const askpassPath = cloneCall?.env.GIT_ASKPASS
    expect(askpassPath).toBeTruthy()
    // 임시 askpass 도우미는 끝나면 지워진다
    expect(existsSync(askpassPath as string)).toBe(false)
    // 다른 git 명령에는 토큰이 전달되지 않는다
    for (const call of rec.calls.filter((c) => c !== cloneCall)) {
      expect(Object.values(call.env).join(' ')).not.toContain(TOKEN)
    }

    // 진행률이 들어온다
    expect(progress.some((p) => p.phase === 'Receiving objects' && p.percent === 100)).toBe(true)

    // 평범한 클론처럼 터미널 git 으로 쓸 수 있다
    expect(await git(['status', '--porcelain'], target)).toBe('')
    expect(await git(['log', '--oneline'], target)).toContain('init')
  }, 30_000)

  it('토큰 없이도 클론하며 askpass 를 쓰지 않는다', async () => {
    const target = join(work, 'n')
    const rec = recordingExec()
    const result = await cloneRepository(
      { owner: 'o', name: 'n', targetDir: target, protocol: 'https' },
      { exec: rec.fn, sourceUrl }
    )
    expect(result).toEqual({ kind: 'cloned', path: target })
    const cloneCall = rec.calls.find((c) => c.args.includes('clone'))
    expect(cloneCall?.env.GIT_ASKPASS).toBeUndefined()
    expect(cloneCall?.env[ASKPASS_TOKEN_ENV]).toBeUndefined()
  }, 30_000)

  it('없는 상위 폴더도 만들어서 클론한다', async () => {
    const target = join(work, 'deep', 'er', 'n')
    const result = await cloneRepository(
      { owner: 'o', name: 'n', targetDir: target, protocol: 'https', token: TOKEN },
      { sourceUrl }
    )
    expect(result).toEqual({ kind: 'cloned', path: target })
  }, 30_000)
})

describe('cloneRepository: SSH', () => {
  it('원격 주소를 git@github.com:<owner>/<name>.git 으로 두고 토큰을 쓰지 않는다', async () => {
    const target = join(work, 'n')
    const rec = recordingExec()
    const result = await cloneRepository(
      { owner: 'o', name: 'n', targetDir: target, protocol: 'ssh', token: TOKEN },
      { exec: rec.fn, sourceUrl }
    )
    expect(result).toEqual({ kind: 'cloned', path: target })
    expect((await git(['remote', 'get-url', 'origin'], target)).trim()).toBe(
      'git@github.com:o/n.git'
    )
    for (const call of rec.calls) {
      expect(call.args.join(' ')).not.toContain(TOKEN)
      expect(Object.values(call.env).join(' ')).not.toContain(TOKEN)
      expect(call.env.GIT_ASKPASS).toBeUndefined()
    }
  }, 30_000)
})

describe('cloneRepository: 실패와 정리', () => {
  const missing = () => pathToFileURL(join(root, 'does-not-exist.git')).href

  it('이번 호출이 만든 폴더는 실패하면 지운다', async () => {
    const target = join(work, 'n')
    const result = await cloneRepository(
      { owner: 'o', name: 'n', targetDir: target, protocol: 'https', token: TOKEN },
      { sourceUrl: missing() }
    )
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      expect(result.message).not.toContain(TOKEN)
      expect(result.message.length).toBeGreaterThan(0)
    }
    expect(existsSync(target)).toBe(false)
  }, 30_000)

  it('원래 있던 빈 폴더는 실패해도 지우지 않는다', async () => {
    const target = join(work, 'n')
    await mkdir(target)
    const result = await cloneRepository(
      { owner: 'o', name: 'n', targetDir: target, protocol: 'https', token: TOKEN },
      { sourceUrl: missing() }
    )
    expect(result.kind).toBe('failed')
    expect(existsSync(target)).toBe(true)
    expect(await readdir(target)).toEqual([])
  }, 30_000)

  it('git 이 토큰을 출력해도 오류 메시지에서는 가린다', async () => {
    const target = join(work, 'n')
    const fakeExec: GitExec = async () => ({
      stdout: '',
      stderr: `fatal: could not read from https://x-access-token:${TOKEN}@github.com/o/n.git\n`,
      exitCode: 128
    })
    const result = await cloneRepository(
      { owner: 'o', name: 'n', targetDir: target, protocol: 'https', token: TOKEN },
      { exec: fakeExec, sourceUrl }
    )
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      expect(result.message).not.toContain(TOKEN)
      expect(result.message).toContain('fatal')
    }
    expect(existsSync(target)).toBe(false)
  })

  it('git 실행 자체가 실패해도 토큰 없는 failed 로 돌려주고 정리한다', async () => {
    const target = join(work, 'n')
    const fakeExec: GitExec = async () => {
      throw new Error(`spawn failed with ${TOKEN}`)
    }
    const result = await cloneRepository(
      { owner: 'o', name: 'n', targetDir: target, protocol: 'https', token: TOKEN },
      { exec: fakeExec, sourceUrl }
    )
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') expect(result.message).not.toContain(TOKEN)
    expect(existsSync(target)).toBe(false)
  })

  it.each([
    ['../evil', 'n'],
    ['o', '..'],
    ['-o', 'n'],
    ['o', 'n/x'],
    ['', 'n']
  ])('잘못된 저장소 이름(%s/%s)은 git 을 부르지 않고 failed', async (owner, name) => {
    const rec = recordingExec()
    const target = join(work, 'n')
    const result = await cloneRepository(
      { owner, name, targetDir: target, protocol: 'https' },
      { exec: rec.fn, sourceUrl }
    )
    expect(result.kind).toBe('failed')
    expect(rec.calls).toHaveLength(0)
    expect(existsSync(target)).toBe(false)
  })

  it('상대 경로 대상은 failed', async () => {
    const rec = recordingExec()
    const result = await cloneRepository(
      { owner: 'o', name: 'n', targetDir: 'relative/n', protocol: 'https' },
      { exec: rec.fn, sourceUrl }
    )
    expect(result.kind).toBe('failed')
    expect(rec.calls).toHaveLength(0)
  })
})

describe('cloneRepository: 취소', () => {
  it('진행 중 취소하면 cancelled 를 돌려주고 만든 폴더를 지운다', async () => {
    const controller = new AbortController()
    const server = await startHangingServer(() => controller.abort())
    try {
      const target = join(work, 'n')
      const result = await cloneRepository(
        {
          owner: 'o',
          name: 'n',
          targetDir: target,
          protocol: 'https',
          token: TOKEN,
          signal: controller.signal
        },
        { sourceUrl: server.url }
      )
      expect(result).toEqual({ kind: 'cancelled' })
      expect(existsSync(target)).toBe(false)
    } finally {
      await server.close()
    }
  }, 30_000)

  it('진행 중 취소해도 원래 있던 빈 폴더는 남긴다', async () => {
    const controller = new AbortController()
    const server = await startHangingServer(() => controller.abort())
    try {
      const target = join(work, 'n')
      await mkdir(target)
      const result = await cloneRepository(
        { owner: 'o', name: 'n', targetDir: target, protocol: 'ssh', signal: controller.signal },
        { sourceUrl: server.url }
      )
      expect(result).toEqual({ kind: 'cancelled' })
      expect(existsSync(target)).toBe(true)
      expect(await readdir(target)).toEqual([])
    } finally {
      await server.close()
    }
  }, 30_000)

  it('git 이 막 시작된 직후 취소해도 cancelled 와 정리', async () => {
    const controller = new AbortController()
    const rec = recordingExec(() => controller.abort())
    const target = join(work, 'n')
    const result = await cloneRepository(
      { owner: 'o', name: 'n', targetDir: target, protocol: 'https', signal: controller.signal },
      { exec: rec.fn, sourceUrl }
    )
    expect(result).toEqual({ kind: 'cancelled' })
    expect(existsSync(target)).toBe(false)
  }, 30_000)

  it('이미 취소된 신호면 아무것도 만들지 않는다', async () => {
    const controller = new AbortController()
    controller.abort()
    const rec = recordingExec()
    const target = join(work, 'n')
    const result = await cloneRepository(
      { owner: 'o', name: 'n', targetDir: target, protocol: 'https', signal: controller.signal },
      { exec: rec.fn, sourceUrl }
    )
    expect(result).toEqual({ kind: 'cancelled' })
    expect(rec.calls).toHaveLength(0)
    expect(existsSync(target)).toBe(false)
  })
})

describe('cloneRepository: 대상이 이미 있음', () => {
  it('같은 저장소의 git 폴더면 exists 와 해석된 원격을 돌려주고 클론하지 않는다', async () => {
    const target = join(work, 'n')
    await mkdir(target)
    await git(['init', '-q'], target)
    await git(['remote', 'add', 'origin', 'git@github.com:o/n.git'], target)
    await git(['remote', 'add', 'upstream', 'https://github.com/up/n'], target)
    const rec = recordingExec()

    const result = await cloneRepository(
      { owner: 'o', name: 'n', targetDir: target, protocol: 'https', token: TOKEN },
      { exec: rec.fn, sourceUrl }
    )

    expect(result).toEqual({
      kind: 'exists',
      remotes: [
        { name: 'origin', url: 'git@github.com:o/n.git', repo: { owner: 'o', name: 'n' } },
        { name: 'upstream', url: 'https://github.com/up/n', repo: { owner: 'up', name: 'n' } }
      ]
    })
    expect(rec.calls.some((c) => c.args.includes('clone'))).toBe(false)
    expect(existsSync(join(target, '.git'))).toBe(true)
  })

  it('git 이 아닌 비어 있지 않은 폴더면 exists, 원격은 빈 배열, 내용은 그대로', async () => {
    const target = join(work, 'n')
    await mkdir(target)
    await writeFile(join(target, 'mine.txt'), 'user data')
    const result = await cloneRepository(
      { owner: 'o', name: 'n', targetDir: target, protocol: 'https' },
      { sourceUrl }
    )
    expect(result).toEqual({ kind: 'exists', remotes: [] })
    expect(await readdir(target)).toEqual(['mine.txt'])
  })

  it('파일이면 exists, 원격은 빈 배열, 파일은 그대로', async () => {
    const target = join(work, 'n')
    await writeFile(target, 'a file')
    const result = await cloneRepository(
      { owner: 'o', name: 'n', targetDir: target, protocol: 'https' },
      { sourceUrl }
    )
    expect(result).toEqual({ kind: 'exists', remotes: [] })
    expect(await readFile(target, 'utf8')).toBe('a file')
  })

  it('빈 폴더면 그 안에 클론한다', async () => {
    const target = join(work, 'n')
    await mkdir(target)
    const result = await cloneRepository(
      { owner: 'o', name: 'n', targetDir: target, protocol: 'https' },
      { sourceUrl }
    )
    expect(result).toEqual({ kind: 'cloned', path: target })
    expect(existsSync(join(target, 'a.txt'))).toBe(true)
  }, 30_000)
})
