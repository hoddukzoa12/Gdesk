import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setRepositoryAccessStatus } from '../cache'
import { addLink, getLink, listAllLinks, setLinkStatus } from '../db/links'
import { isolateGitConfig } from '../git/test-helpers'
import { cacheRepo, createHarness, makeWorkingCopy } from './test-helpers'
import type { Harness } from './test-helpers'

let root: string
let dir: string
let h: Harness

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'gdesk-link-test-')))
  isolateGitConfig(root)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

let seq = 0
beforeEach(async () => {
  dir = join(root, `case-${++seq}`)
  await mkdir(dir)
  h = createHarness({ baseDir: join(root, 'unused-base') })
  cacheRepo(h.db, 1, 'me', 'app')
  cacheRepo(h.db, 2, 'org', 'app')
  cacheRepo(h.db, 3, 'me', 'other')
})

afterEach(() => {
  h.db.close()
})

describe('local:listLinks 접근 상태', () => {
  it('캐시의 접근 상태를 붙이고, 캐시에 없는 저장소는 available', () => {
    setRepositoryAccessStatus(h.db, 2, 'unavailable')
    const a = addLink(h.db, 1, join(dir, 'a'), { platform: 'linux' }).link
    const b = addLink(h.db, 2, join(dir, 'b'), { platform: 'linux' }).link
    const c = addLink(h.db, 99, join(dir, 'c'), { platform: 'linux' }).link
    const byId = new Map(h.service.listLinks().map((l) => [l.id, l.accessStatus]))
    expect(byId.get(a.id)).toBe('available')
    expect(byId.get(b.id)).toBe('unavailable')
    expect(byId.get(c.id)).toBe('available')
    expect(h.service.listLinks({ repoId: 2 })).toEqual([
      { ...b, accessStatus: 'unavailable', fullName: 'org/app' }
    ])
    expect(h.service.listLinks({ repoId: 99 })[0]?.fullName).toBeNull()
  })
})

describe('local:link', () => {
  it('GitHub 원격이 없으면 not_github 로 거부한다', async () => {
    const repo = await makeWorkingCopy(join(dir, 'r'), [['origin', 'https://gitlab.com/me/app']])
    expect(await h.service.link({ path: repo })).toEqual({ ok: false, reason: 'not_github' })
    const bare = await makeWorkingCopy(join(dir, 'no-remote'), [])
    expect(await h.service.link({ repoId: 1, path: bare })).toEqual({
      ok: false,
      reason: 'not_github'
    })
    expect(listAllLinks(h.db)).toEqual([])
  })

  it('git 폴더가 아니면 not_git, 없는 폴더는 path_not_found', async () => {
    expect(await h.service.link({ path: dir })).toEqual({ ok: false, reason: 'not_git' })
    expect(await h.service.link({ path: join(dir, 'nope') })).toEqual({
      ok: false,
      reason: 'path_not_found'
    })
    expect(await h.service.link({ path: 'relative/path' })).toEqual({
      ok: false,
      reason: 'path_not_found'
    })
  })

  it('지정한 저장소와 원격이 다르면 different_repo', async () => {
    const repo = await makeWorkingCopy(join(dir, 'r'), [['origin', 'https://github.com/me/other']])
    expect(await h.service.link({ repoId: 1, path: repo })).toEqual({
      ok: false,
      reason: 'different_repo'
    })
    expect(listAllLinks(h.db)).toEqual([])
  })

  it('지정한 저장소와 맞으면 연결하고 알린다(대소문자 무시, upstream 도 인정)', async () => {
    const repo = await makeWorkingCopy(join(dir, 'r'), [
      ['origin', 'git@github.com:ME/other.git'],
      ['upstream', 'https://github.com/Org/App.git']
    ])
    const result = await h.service.link({ repoId: 2, path: repo })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.links.map((l) => [l.repoId, l.path, l.status])).toEqual([[2, repo, 'ok']])
    expect(h.notified).toEqual([['repo:2', 'sidebar']])
  })

  it('저장소를 지정하지 않으면 원격이 가리키는 저장소(포크면 둘 다)에 연결한다', async () => {
    const repo = await makeWorkingCopy(join(dir, 'r'), [
      ['origin', 'https://github.com/me/app'],
      ['upstream', 'https://github.com/org/app']
    ])
    const result = await h.service.link({ path: repo })
    expect(result.ok && result.links.map((l) => l.repoId).sort()).toEqual([1, 2])
  })

  it('원격의 저장소를 확인할 수 없으면 unresolved', async () => {
    const repo = await makeWorkingCopy(join(dir, 'r'), [['origin', 'https://github.com/x/y']])
    h.state.status = 'offline'
    expect(await h.service.link({ path: repo })).toEqual({ ok: false, reason: 'unresolved' })
    expect(await h.service.link({ repoId: 99, path: repo })).toEqual({
      ok: false,
      reason: 'unresolved'
    })
  })

  it('이미 있던 missing 연결을 다시 연결하면 ok 로 돌린다', async () => {
    const repo = await makeWorkingCopy(join(dir, 'r'), [['origin', 'https://github.com/me/app']])
    const { link } = addLink(h.db, 1, repo)
    setLinkStatus(h.db, link.id, 'missing')
    const result = await h.service.link({ repoId: 1, path: repo })
    expect(result).toEqual({ ok: true, links: [expect.objectContaining({ id: link.id })] })
    expect(getLink(h.db, link.id)?.status).toBe('ok')
  })
})

describe('local:unlink', () => {
  it('DB 행만 지우고 폴더는 그대로 둔다', async () => {
    const repo = await makeWorkingCopy(join(dir, 'r'), [['origin', 'https://github.com/me/app']])
    const { link } = addLink(h.db, 1, repo)
    expect(h.service.unlink({ linkId: link.id })).toEqual({ removed: true })
    expect(getLink(h.db, link.id)).toBeNull()
    expect(existsSync(join(repo, '.git'))).toBe(true)
    expect(h.notified).toEqual([['repo:1', 'sidebar']])
    expect(h.service.unlink({ linkId: link.id })).toEqual({ removed: false })
  })
})

describe('local:relink', () => {
  it('새 경로를 같은 방식으로 검사하고 연결을 옮긴다(옛 폴더는 건드리지 않음)', async () => {
    const oldDir = join(dir, 'old')
    const { link } = addLink(h.db, 1, oldDir)
    setLinkStatus(h.db, link.id, 'missing')

    const wrong = await makeWorkingCopy(join(dir, 'w'), [['origin', 'https://github.com/me/other']])
    expect(await h.service.relink({ linkId: link.id, path: wrong })).toEqual({
      ok: false,
      reason: 'different_repo'
    })

    const moved = await makeWorkingCopy(join(dir, 'moved'), [
      ['origin', 'https://github.com/me/app']
    ])
    const result = await h.service.relink({ linkId: link.id, path: moved })
    expect(result.ok).toBe(true)
    const all = listAllLinks(h.db)
    expect(all.map((l) => [l.repoId, l.path, l.status])).toEqual([[1, moved, 'ok']])
    expect(await h.service.relink({ linkId: 12345, path: moved })).toEqual({
      ok: false,
      reason: 'link_not_found'
    })
  })
})
