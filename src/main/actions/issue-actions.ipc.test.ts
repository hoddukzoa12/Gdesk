import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionStatus } from '@shared/domain/connection'

// IPC 등록이 서비스·클라이언트·세션·동기화 엔진을 올바르게 잇고, 화면에서 온 값을 검사하는지 본다.
const handlers = new Map<string, (req: unknown) => unknown>()
let status: ConnectionStatus = 'online'
let sessionState = 'signed_in'
let db: DatabaseSync | null = null
const graphql = vi.fn(async () => ({ data: { closeIssue: {} }, errors: [], orgRestrictions: [] }))
const refresh = vi.fn(async () => undefined)
const notifyDataChanged = vi.fn()

vi.mock('../ipc/registry', () => ({
  handle: (channel: string, handler: (req: unknown) => unknown) => handlers.set(channel, handler),
  emit: vi.fn()
}))

vi.mock('../ipc/data-events', () => ({ notifyDataChanged }))

vi.mock('../db/db', () => ({
  getDb: () => {
    if (db === null) throw new Error('no db in this test')
    return db
  }
}))

vi.mock('../github/client', () => ({
  getGitHubClient: () => ({
    getStatus: () => status,
    graphql,
    post: vi.fn(),
    getAllPages: vi.fn()
  })
}))

vi.mock('../auth', () => ({
  getAuthService: () => ({ getSession: () => ({ state: sessionState }) })
}))

vi.mock('../sync', () => ({ getSyncEngine: () => ({ refresh }) }))

const { registerIpc } = await import('./issue-actions.ipc')
const { openDatabase } = await import('../db/connection')
const { saveIssueDetail } = await import('../cache')
const { issueDetailRecord } = await import('../cache/test-fixtures')

const REF = { repoId: 1, number: 5 }

describe('issueActions IPC', () => {
  beforeEach(() => {
    db = openDatabase(':memory:')
    saveIssueDetail(db, issueDetailRecord(1, 5))
    registerIpc()
  })

  afterEach(() => {
    handlers.clear()
    db?.close()
    db = null
    status = 'online'
    sessionState = 'signed_in'
    vi.clearAllMocks()
  })

  function call(channel: string, req: unknown): Promise<unknown> {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`no handler: ${channel}`)
    return Promise.resolve().then(() => handler(req))
  }

  it('채널 여섯 개를 등록한다', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'issueActions:comment',
      'issueActions:create',
      'issueActions:previewMarkdown',
      'issueActions:react',
      'issueActions:repoMeta',
      'issueActions:setState'
    ])
  })

  it('잘못된 요청 값은 거부한다(요청 없음)', async () => {
    await expect(
      call('issueActions:react', { subjectId: 'x', issueRef: REF, content: 'NOPE', add: true })
    ).rejects.toThrow()
    await expect(
      call('issueActions:comment', { issueRef: { repoId: 'a' }, body: 'x' })
    ).rejects.toThrow()
    await expect(
      call('issueActions:setState', { issueRef: REF, state: 'merged' })
    ).rejects.toThrow()
    await expect(call('issueActions:create', { repoId: 0, title: 'T' })).rejects.toThrow()
    await expect(call('issueActions:repoMeta', { repoId: 1.5 })).rejects.toThrow()
    await expect(call('issueActions:previewMarkdown', { repoId: 1, text: 3 })).rejects.toThrow()
    await expect(call('issueActions:setState', undefined)).rejects.toThrow()
    expect(graphql).not.toHaveBeenCalled()
  })

  it('닫기 성공은 알리고 동기화 엔진에 이슈 목록 새로 받기를 요청한다', async () => {
    await expect(
      call('issueActions:setState', { issueRef: REF, state: 'closed' })
    ).resolves.toEqual({ ok: true })
    expect(graphql).toHaveBeenCalledTimes(1)
    expect(notifyDataChanged).toHaveBeenCalledWith(
      expect.arrayContaining(['issues', 'home', 'issue:1#5'])
    )
    expect(refresh).toHaveBeenCalledWith('issues')
  })

  it('막히면 요청 없이 이유를 돌려준다', async () => {
    status = 'offline'
    await expect(
      call('issueActions:setState', { issueRef: REF, state: 'closed' })
    ).resolves.toEqual({ ok: false, reason: 'offline' })
    sessionState = 'signed_out'
    status = 'online'
    await expect(
      call('issueActions:react', { subjectId: 'I_1_5', issueRef: REF, content: 'EYES', add: true })
    ).resolves.toEqual({ ok: false, reason: 'signed_out' })
    expect(graphql).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
})
