import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncStatus } from '@shared/domain/sync'

const handlers = new Map<string, (req: unknown) => unknown>()
const emitted: { event: string; payload: unknown }[] = []
const statusListeners = new Set<(s: SyncStatus) => void>()
const engine = {
  getStatus: vi.fn((): SyncStatus => ({
    connection: 'online',
    lastSyncedAt: 1,
    rateLimitedUntil: null,
    syncing: false,
    orgRestrictions: []
  })),
  refresh: vi.fn(async () => {}),
  setViewedRepo: vi.fn(async () => {})
}
let engineReady = true

vi.mock('../ipc/registry', () => ({
  handle: (channel: string, handler: (req: unknown) => unknown) => handlers.set(channel, handler),
  emit: (event: string, payload: unknown) => emitted.push({ event, payload })
}))
vi.mock('./index', () => ({
  getSyncEngine: () => (engineReady ? engine : null),
  onSyncStatus: (l: (s: SyncStatus) => void) => {
    statusListeners.add(l)
    return () => statusListeners.delete(l)
  }
}))
vi.mock('../github/client', () => ({
  getGitHubClient: () => ({ getStatus: () => 'offline' })
}))

const { registerIpc } = await import('./sync.ipc')

describe('sync IPC', () => {
  beforeEach(() => {
    handlers.clear()
    emitted.length = 0
    statusListeners.clear()
    engineReady = true
    vi.clearAllMocks()
    registerIpc()
  })

  it('채널을 등록하고 상태 변경을 sync:status 로 보낸다', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'sync:getStatus',
      'sync:refresh',
      'sync:setViewedRepo'
    ])
    const status: SyncStatus = {
      connection: 'offline',
      lastSyncedAt: 5,
      rateLimitedUntil: null,
      syncing: false,
      orgRestrictions: []
    }
    for (const l of statusListeners) l(status)
    expect(emitted).toEqual([{ event: 'sync:status', payload: status }])
  })

  it('getStatus 는 엔진 값, 엔진 전에는 요청 계층 상태만', () => {
    expect(handlers.get('sync:getStatus')?.(undefined)).toMatchObject({ lastSyncedAt: 1 })
    engineReady = false
    expect(handlers.get('sync:getStatus')?.(undefined)).toEqual({
      connection: 'offline',
      lastSyncedAt: null,
      rateLimitedUntil: null,
      syncing: false,
      orgRestrictions: []
    })
  })

  it('refresh·setViewedRepo 를 엔진에 넘기고 잘못된 ID 는 거절한다', async () => {
    await handlers.get('sync:refresh')?.({ scope: 'inbox' })
    expect(engine.refresh).toHaveBeenCalledWith('inbox')
    handlers.get('sync:setViewedRepo')?.({ repoId: 7 })
    handlers.get('sync:setViewedRepo')?.({ repoId: null })
    expect(engine.setViewedRepo.mock.calls).toEqual([[7], [null]])
    expect(() => handlers.get('sync:setViewedRepo')?.({ repoId: 'x' })).toThrow()
    expect(() => handlers.get('sync:setViewedRepo')?.({ repoId: 0 })).toThrow()
  })
})
