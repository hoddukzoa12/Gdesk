import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { cloneRepository } from '../../src/main/git/clone'
import { git, isolateGitConfig } from '../../src/main/git/test-helpers'
import { FIXTURE, startFakeGitHub } from '../fixtures/github'
import { readGitFile } from '../fixtures/github/git'
import type { FakeGitHub } from '../fixtures/github'

// 가짜 서버의 클론 원본(git dumb HTTP). 앱의 클론 코드가 sourceUrl 로 이 주소에서 받을 수 있는지 본다.

let server: FakeGitHub
let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'gdesk-fake-git-test-'))
  isolateGitConfig(root)
  server = await startFakeGitHub({ gitRepos: [FIXTURE.repos.demo.fullName] })
})

afterAll(async () => {
  await server.close()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

describe('가짜 서버의 클론 원본', () => {
  it('앱의 cloneRepository 가 HTTP 로 클론하고 원격 주소는 표준 주소로 맞춘다', async () => {
    const target = join(root, 'clones', 'gdesk-demo')
    const result = await cloneRepository(
      {
        owner: 'octo-maintainer',
        name: 'gdesk-demo',
        targetDir: target,
        protocol: 'https',
        token: FIXTURE.token
      },
      { sourceUrl: server.gitUrl(FIXTURE.repos.demo.fullName) }
    )
    expect(result).toEqual({ kind: 'cloned', path: target })
    expect(await readFile(join(target, 'README.md'), 'utf8')).toContain(
      'octo-maintainer/gdesk-demo'
    )
    expect((await git(['remote', 'get-url', 'origin'], target)).trim()).toBe(
      'https://github.com/octo-maintainer/gdesk-demo.git'
    )
    expect(server.hasRequest((r) => r.path.endsWith('.git/info/refs'))).toBe(true)
  })

  it('없는 저장소는 404 라 클론이 실패한다', async () => {
    const result = await cloneRepository(
      {
        owner: 'octo-maintainer',
        name: 'missing',
        targetDir: join(root, 'clones', 'missing'),
        protocol: 'https'
      },
      { sourceUrl: server.gitUrl('octo-maintainer/missing') }
    )
    expect(result.kind).toBe('failed')
  })

  it('저장소 폴더 밖 파일은 내주지 않는다', () => {
    const root = server.gitRoot ?? ''
    expect(readGitFile(root, '/octo-maintainer/gdesk-demo.git/HEAD')).not.toBeNull()
    expect(readGitFile(root, '/octo-maintainer/gdesk-demo.git/../../.empty-gitconfig')).toBeNull()
    expect(readGitFile(root, '/octo-maintainer/gdesk-demo.git/%2e%2e/x')).toBeNull()
    expect(readGitFile(root, '/..%2f..%2fetc/passwd.git/x')).toBeNull()
  })
})
