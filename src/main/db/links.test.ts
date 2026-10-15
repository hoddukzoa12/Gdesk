import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './connection'
import {
  addLink,
  listAllLinks,
  listLinksByRepo,
  normalizeLinkPath,
  removeLink,
  setLinkStatus,
  touchLink
} from './links'

// 실제 파일 시스템을 건드리지 않도록 존재하지 않는 경로를 쓴다(resolve 대체 경로를 탄다)
const ghost = '/gdesk-nonexistent-test-root'

describe('normalizeLinkPath', () => {
  it('끝 구분자를 뗀다', () => {
    expect(normalizeLinkPath(`${ghost}/Repo/`, { platform: 'linux' }).path).toBe(`${ghost}/Repo`)
    expect(normalizeLinkPath(`${ghost}/Repo///`, { platform: 'linux' }).path).toBe(`${ghost}/Repo`)
  })

  it('루트는 빈 문자열이 되지 않는다', () => {
    const realpath = (): string => '/'
    expect(normalizeLinkPath('/', { platform: 'linux', realpath }).path).toBe('/')
  })

  it('상대 경로는 절대 경로로 푼다', () => {
    const result = normalizeLinkPath('gdesk-nonexistent-relative/x', { platform: 'linux' })
    expect(result.path).toBe(join(process.cwd(), 'gdesk-nonexistent-relative/x'))
  })

  it('darwin·win32 는 대소문자를 무시한 키, linux 는 그대로', () => {
    const a = normalizeLinkPath(`${ghost}/Repo`, { platform: 'darwin' })
    const b = normalizeLinkPath(`${ghost}/repo`, { platform: 'darwin' })
    expect(a.key).toBe(b.key)
    expect(a.path).toBe(`${ghost}/Repo`)
    const w1 = normalizeLinkPath(`${ghost}/Repo`, { platform: 'win32' })
    const w2 = normalizeLinkPath(`${ghost}/REPO`, { platform: 'win32' })
    expect(w1.key).toBe(w2.key)
    const l1 = normalizeLinkPath(`${ghost}/Repo`, { platform: 'linux' })
    const l2 = normalizeLinkPath(`${ghost}/repo`, { platform: 'linux' })
    expect(l1.key).not.toBe(l2.key)
  })
})

describe('local link store', () => {
  let db: DatabaseSync
  let tmp: string

  beforeEach(() => {
    db = openDatabase(':memory:')
    tmp = mkdtempSync(join(tmpdir(), 'gdesk-links-'))
  })

  afterEach(() => {
    db.close()
    rmSync(tmp, { recursive: true, force: true })
  })

  it('추가하고 저장소별·전체 목록을 돌려준다', () => {
    const first = addLink(db, 1, `${ghost}/a`, { platform: 'linux', now: 100 })
    expect(first.created).toBe(true)
    expect(first.link).toEqual({
      id: expect.any(Number),
      repoId: 1,
      path: `${ghost}/a`,
      lastUsedAt: 100,
      status: 'ok'
    })
    addLink(db, 1, `${ghost}/b`, { platform: 'linux', now: 200 })
    addLink(db, 2, `${ghost}/a`, { platform: 'linux', now: 300 })
    expect(listLinksByRepo(db, 1).map((l) => l.path)).toEqual([`${ghost}/b`, `${ghost}/a`])
    expect(listAllLinks(db)).toHaveLength(3)
  })

  it('끝 구분자만 다른 경로는 중복으로 보고 기존 연결을 돌려준다', () => {
    const a = addLink(db, 1, `${ghost}/a`, { platform: 'linux' })
    const b = addLink(db, 1, `${ghost}/a/`, { platform: 'linux' })
    expect(b.created).toBe(false)
    expect(b.link.id).toBe(a.link.id)
    expect(listLinksByRepo(db, 1)).toHaveLength(1)
  })

  it('심볼릭 링크는 실제 경로로 풀어 중복을 막는다', () => {
    const real = join(tmp, 'real')
    mkdirSync(real)
    const alias = join(tmp, 'alias')
    symlinkSync(real, alias)
    const a = addLink(db, 1, real, { platform: 'linux' })
    const b = addLink(db, 1, alias, { platform: 'linux' })
    expect(b.created).toBe(false)
    expect(b.link.id).toBe(a.link.id)
    expect(listLinksByRepo(db, 1)).toHaveLength(1)
  })

  it('대소문자: darwin 에서는 중복, linux 에서는 별개', () => {
    addLink(db, 1, `${ghost}/Repo`, { platform: 'darwin' })
    expect(addLink(db, 1, `${ghost}/repo`, { platform: 'darwin' }).created).toBe(false)
    expect(listLinksByRepo(db, 1)).toHaveLength(1)

    addLink(db, 2, `${ghost}/Repo`, { platform: 'linux' })
    expect(addLink(db, 2, `${ghost}/repo`, { platform: 'linux' }).created).toBe(true)
    expect(listLinksByRepo(db, 2)).toHaveLength(2)
  })

  it('같은 폴더를 다른 저장소에 연결할 수 있다', () => {
    expect(addLink(db, 1, `${ghost}/a`, { platform: 'linux' }).created).toBe(true)
    expect(addLink(db, 2, `${ghost}/a`, { platform: 'linux' }).created).toBe(true)
  })

  it('상태 변경, 사용 시각 갱신, 삭제(DB 행만)', () => {
    const dir = join(tmp, 'keep')
    mkdirSync(dir)
    const { link } = addLink(db, 1, dir, { platform: 'linux', now: 1 })
    expect(setLinkStatus(db, link.id, 'missing')).toBe(true)
    expect(touchLink(db, link.id, 999)).toBe(true)
    expect(listLinksByRepo(db, 1)[0]).toMatchObject({ status: 'missing', lastUsedAt: 999 })
    expect(removeLink(db, link.id)).toBe(true)
    expect(removeLink(db, link.id)).toBe(false)
    expect(listAllLinks(db)).toEqual([])
    // 폴더는 지우지 않는다
    expect(() => mkdirSync(dir)).toThrow(/EEXIST/)
  })

  it('잘못된 상태 값은 거부한다', () => {
    const { link } = addLink(db, 1, `${ghost}/a`, { platform: 'linux' })
    expect(() => setLinkStatus(db, link.id, 'gone' as never)).toThrow()
  })
})
