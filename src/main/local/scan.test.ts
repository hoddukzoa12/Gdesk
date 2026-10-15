import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { addLink, listAllLinks, listLinksByRepo } from '../db/links'
import { isolateGitConfig } from '../git/test-helpers'
import { findGitWorkingCopies } from './scan'
import { cacheRepo, createHarness, makeWorkingCopy } from './test-helpers'
import type { Harness } from './test-helpers'

let root: string
let base: string
let h: Harness

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'gdesk-scan-test-')))
  isolateGitConfig(root)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

let seq = 0
beforeEach(async () => {
  base = join(root, `base-${++seq}`)
  await mkdir(base)
  h = createHarness({ baseDir: base })
})

afterEach(() => {
  h.db.close()
})

const repoIdsAt = (path: string) =>
  listAllLinks(h.db)
    .filter((l) => l.path === path)
    .map((l) => l.repoId)
    .sort()

describe('findGitWorkingCopies', () => {
  it('깊이 2 까지 찾고, 숨김·node_modules 는 건너뛰고, 저장소 안으로는 내려가지 않는다', async () => {
    await makeWorkingCopy(join(base, 'a'), [])
    await makeWorkingCopy(join(base, 'group', 'b'), [])
    await makeWorkingCopy(join(base, 'group', 'deep', 'c'), []) // 깊이 3
    await makeWorkingCopy(join(base, '.hidden', 'd'), [])
    await makeWorkingCopy(join(base, 'node_modules', 'e'), [])
    await makeWorkingCopy(join(base, 'a', 'nested'), [])
    const found = (await findGitWorkingCopies(base)).sort()
    expect(found).toEqual([join(base, 'a'), join(base, 'group', 'b')])
    const deeper = await findGitWorkingCopies(base, { maxDepth: 3 })
    expect(deeper).toContain(join(base, 'group', 'deep', 'c'))
  })

  it('심볼릭 링크 고리에서 멈춘다', async () => {
    await makeWorkingCopy(join(base, 'loop', 'r'), [])
    await symlink(base, join(base, 'loop', 'back'))
    await symlink(join(base, 'loop'), join(base, 'again'))
    const found = await findGitWorkingCopies(base, { maxDepth: 5 })
    expect(found.filter((p) => p.endsWith('r')).length).toBe(1)
  })

  it('기본 폴더가 없으면 빈 목록', async () => {
    expect(await findGitWorkingCopies(join(base, 'nope'))).toEqual([])
  })
})

describe('LocalService.rescan', () => {
  it('포크 클론은 origin 과 upstream 저장소 둘 다 연결한다(HTTPS·SSH)', async () => {
    cacheRepo(h.db, 10, 'me', 'proj')
    cacheRepo(h.db, 20, 'upstream-org', 'proj')
    const dir = await makeWorkingCopy(join(base, 'proj'), [
      ['origin', 'git@github.com:me/proj.git'],
      ['upstream', 'https://github.com/Upstream-Org/proj.git']
    ])
    const summary = await h.service.rescan()
    expect(summary).toMatchObject({ found: 1, added: 2 })
    expect(repoIdsAt(dir)).toEqual([10, 20])
    expect(h.lookups).toEqual([]) // 캐시로 풀었으면 API 를 부르지 않는다
    expect(h.notified.flat()).toEqual(expect.arrayContaining(['repo:10', 'repo:20', 'sidebar']))
  })

  it('캐시에 없는 옛 이름은 GitHub 조회(리다이렉트)로 같은 저장소 ID 에 연결한다', async () => {
    cacheRepo(h.db, 30, 'me', 'new-name')
    h.state.api.set('me/old-name', 30)
    const dir = await makeWorkingCopy(join(base, 'old'), [
      ['origin', 'ssh://git@github.com/me/old-name.git']
    ])
    await h.service.rescan()
    expect(repoIdsAt(dir)).toEqual([30])
    expect(h.lookups).toEqual(['me/old-name'])
  })

  it('오프라인이거나 로그인 전이면 API 를 부르지 않고 건너뛴다', async () => {
    h.state.api.set('me/unknown', 40)
    await makeWorkingCopy(join(base, 'u'), [['origin', 'https://github.com/me/unknown']])
    h.state.status = 'offline'
    await h.service.rescan()
    h.state.status = 'online'
    h.state.session = 'signed_out'
    await h.service.rescan()
    expect(h.lookups).toEqual([])
    expect(listAllLinks(h.db)).toEqual([])
  })

  it('GitHub 이 아닌 원격·origin/upstream 이 아닌 원격·풀 수 없는 저장소는 건너뛴다', async () => {
    cacheRepo(h.db, 50, 'me', 'other')
    await makeWorkingCopy(join(base, 'gitlab'), [['origin', 'git@gitlab.com:me/x.git']])
    await makeWorkingCopy(join(base, 'side'), [['mirror', 'https://github.com/me/other.git']])
    await makeWorkingCopy(join(base, 'gone'), [['origin', 'https://github.com/me/deleted.git']])
    await writeFile(join(base, 'file.txt'), 'x')
    const summary = await h.service.rescan()
    expect(summary).toMatchObject({ found: 3, added: 0 })
    expect(listAllLinks(h.db)).toEqual([])
  })

  it('깊이 제한을 지킨다(조정 가능)', async () => {
    cacheRepo(h.db, 60, 'me', 'deep')
    const dir = await makeWorkingCopy(join(base, 'x', 'y', 'deep'), [
      ['origin', 'https://github.com/me/deep']
    ])
    await h.service.rescan()
    expect(listAllLinks(h.db)).toEqual([])
    const deeper = createHarness({ baseDir: base, deps: { scanDepth: 3 } })
    cacheRepo(deeper.db, 60, 'me', 'deep')
    await deeper.service.rescan()
    expect(listAllLinks(deeper.db).map((l) => [l.repoId, l.path])).toEqual([[60, dir]])
    deeper.db.close()
  })

  it('중복 연결을 만들지 않는다', async () => {
    cacheRepo(h.db, 70, 'me', 'dup')
    await makeWorkingCopy(join(base, 'dup'), [['origin', 'https://github.com/me/dup']])
    await h.service.rescan()
    const second = await h.service.rescan()
    expect(second.added).toBe(0)
    expect(listLinksByRepo(h.db, 70)).toHaveLength(1)
  })

  it('기존 연결을 다시 확인한다: 사라진 폴더·git 아님·다른 저장소는 missing, 되살아나면 ok', async () => {
    cacheRepo(h.db, 80, 'me', 'a')
    cacheRepo(h.db, 81, 'me', 'b')
    const outside = join(root, `outside-${seq}`)
    const okDir = await makeWorkingCopy(join(outside, 'ok'), [
      ['origin', 'https://github.com/me/a']
    ])
    const otherDir = await makeWorkingCopy(join(outside, 'other'), [
      ['origin', 'https://github.com/me/b']
    ])
    const plainDir = join(outside, 'plain')
    await mkdir(plainDir)
    const goneDir = join(outside, 'gone')
    const ok = addLink(h.db, 80, okDir).link
    const other = addLink(h.db, 80, otherDir).link
    const plain = addLink(h.db, 80, plainDir).link
    const gone = addLink(h.db, 80, goneDir).link

    const summary = await h.service.rescan()
    const status = (id: number) => listAllLinks(h.db).find((l) => l.id === id)?.status
    expect(status(ok.id)).toBe('ok')
    expect(status(other.id)).toBe('missing')
    expect(status(plain.id)).toBe('missing')
    expect(status(gone.id)).toBe('missing')
    expect(summary.missing).toBe(3)
    expect(h.notified.flat()).toContain('repo:80')

    await makeWorkingCopy(goneDir, [['origin', 'https://github.com/me/a']])
    await h.service.rescan()
    expect(status(gone.id)).toBe('ok')
  })

  it('확인할 수 없으면(오프라인·캐시 없음) 상태를 바꾸지 않는다', async () => {
    const dir = await makeWorkingCopy(join(root, `unk-${seq}`), [
      ['origin', 'https://github.com/someone/unknown']
    ])
    const link = addLink(h.db, 90, dir).link
    h.state.status = 'offline'
    await h.service.rescan()
    expect(listAllLinks(h.db).find((l) => l.id === link.id)?.status).toBe('ok')
  })

  it('겹친 요청은 합친다', async () => {
    cacheRepo(h.db, 95, 'me', 'c')
    await makeWorkingCopy(join(base, 'c'), [['origin', 'https://github.com/me/c']])
    const results = await Promise.all([h.service.rescan(), h.service.rescan(), h.service.rescan()])
    expect(results.reduce((n, r) => n + r.added, 0)).toBe(1)
    expect(listLinksByRepo(h.db, 95)).toHaveLength(1)
  })

  it('클론 중인 대상 폴더는 연결하지 않는다', async () => {
    cacheRepo(h.db, 96, 'me', 'busy')
    let ready!: () => void
    const started = new Promise<void>((resolve) => (ready = resolve))
    h.state.cloneResult = async (o) => {
      await makeWorkingCopy(o.targetDir, [['origin', 'https://github.com/me/busy.git']])
      ready()
      await new Promise((resolve) => o.signal?.addEventListener('abort', resolve))
      return { kind: 'cancelled' }
    }
    const cloning = h.service.clone({ cloneId: 'busy', repoId: 96, owner: 'me', name: 'busy' })
    await started
    expect((await h.service.rescan()).added).toBe(0)
    h.service.cancelClone({ cloneId: 'busy' })
    await cloning
    expect(listLinksByRepo(h.db, 96)).toEqual([])
  })
})
