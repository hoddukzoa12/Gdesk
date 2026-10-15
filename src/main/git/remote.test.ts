import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseGitHubRemote, readGitHubRemotes } from './remote'
import { git, isolateGitConfig } from './test-helpers'

describe('parseGitHubRemote', () => {
  it.each([
    ['https://github.com/o/n', { owner: 'o', name: 'n' }],
    ['https://github.com/o/n.git', { owner: 'o', name: 'n' }],
    ['https://github.com/o/n/', { owner: 'o', name: 'n' }],
    ['https://github.com/o/n.git/', { owner: 'o', name: 'n' }],
    ['https://user@github.com/o/n.git', { owner: 'o', name: 'n' }],
    ['https://x-access-token@github.com/o/n', { owner: 'o', name: 'n' }],
    ['https://GitHub.COM/Owner/Repo.git', { owner: 'Owner', name: 'Repo' }],
    ['http://github.com/o/n', { owner: 'o', name: 'n' }],
    ['https://github.com/my-org/my.repo-name_1.git', { owner: 'my-org', name: 'my.repo-name_1' }],
    ['git@github.com:o/n.git', { owner: 'o', name: 'n' }],
    ['git@github.com:o/n', { owner: 'o', name: 'n' }],
    ['git@GitHub.com:o/n.git', { owner: 'o', name: 'n' }],
    ['ssh://git@github.com/o/n.git', { owner: 'o', name: 'n' }],
    ['ssh://git@github.com/o/n', { owner: 'o', name: 'n' }],
    ['ssh://git@github.com:22/o/n.git', { owner: 'o', name: 'n' }],
    ['  https://github.com/o/n.git\n', { owner: 'o', name: 'n' }]
  ])('%s → %o', (url, expected) => {
    expect(parseGitHubRemote(url)).toEqual(expected)
  })

  it.each([
    'https://gitlab.com/o/n.git',
    'https://www.github.com/o/n',
    'https://github.com.evil.com/o/n',
    'https://evil.com/github.com/o/n',
    'git@gitlab.com:o/n.git',
    'git@github.com.evil.com:o/n.git',
    'ssh://git@bitbucket.org/o/n.git',
    'https://github.com/o',
    'https://github.com/o/n/extra',
    'https://github.com/',
    'git@github.com:o',
    'git@github.com:o/n/extra',
    'file:///tmp/o/n.git',
    '/tmp/o/n.git',
    'https://github.com/o/.git',
    'https://github.com/../n',
    'not a url',
    ''
  ])('%s → null', (url) => {
    expect(parseGitHubRemote(url)).toBeNull()
  })
})

describe('readGitHubRemotes', () => {
  let root: string

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'gdesk-remote-test-')))
    isolateGitConfig(root)
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  })

  it('origin 과 upstream 을 해석해서 돌려준다(origin, upstream 순)', async () => {
    const dir = join(root, 'repo')
    await mkdir(dir)
    await git(['init', '-q'], dir)
    await git(['remote', 'add', 'upstream', 'git@github.com:up/stream.git'], dir)
    await git(['remote', 'add', 'origin', 'https://github.com/me/fork.git'], dir)
    await git(['remote', 'add', 'other', 'https://gitlab.com/x/y.git'], dir)

    const remotes = await readGitHubRemotes(dir)
    expect(remotes).not.toBeNull()
    expect(remotes?.slice(0, 2)).toEqual([
      {
        name: 'origin',
        url: 'https://github.com/me/fork.git',
        repo: { owner: 'me', name: 'fork' }
      },
      {
        name: 'upstream',
        url: 'git@github.com:up/stream.git',
        repo: { owner: 'up', name: 'stream' }
      }
    ])
    expect(remotes).toContainEqual({ name: 'other', url: 'https://gitlab.com/x/y.git', repo: null })
  })

  it('원격이 없는 저장소는 빈 배열', async () => {
    const dir = join(root, 'no-remote')
    await mkdir(dir)
    await git(['init', '-q'], dir)
    await expect(readGitHubRemotes(dir)).resolves.toEqual([])
  })

  it('git 저장소가 아니면 null', async () => {
    const dir = join(root, 'plain')
    await mkdir(dir)
    await expect(readGitHubRemotes(dir)).resolves.toBeNull()
  })

  it('다른 저장소 안의 하위 폴더는 부모 저장소의 원격을 빌려 오지 않는다', async () => {
    const parent = join(root, 'parent')
    await mkdir(join(parent, 'sub'), { recursive: true })
    await git(['init', '-q'], parent)
    await git(['remote', 'add', 'origin', 'https://github.com/p/arent.git'], parent)
    await expect(readGitHubRemotes(join(parent, 'sub'))).resolves.toBeNull()
  })

  it('없는 경로나 파일이면 null', async () => {
    await expect(readGitHubRemotes(join(root, 'missing'))).resolves.toBeNull()
    const file = join(root, 'file.txt')
    await writeFile(file, 'x')
    await expect(readGitHubRemotes(file)).resolves.toBeNull()
  })
})
