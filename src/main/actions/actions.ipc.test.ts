import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionStatus } from '@shared/domain/connection'

// IPC 등록이 서비스·클라이언트·세션·이벤트를 올바르게 잇는지 본다.
const handlers = new Map<string, (req: unknown) => unknown>()
const emitted: { event: string; payload: unknown }[] = []
const statusListeners = new Set<(s: ConnectionStatus) => void>()
const authListeners = new Set<() => void>()
let status: ConnectionStatus = 'online'
let sessionState = 'signed_in'

vi.mock('../ipc/registry', () => ({
  handle: (channel: string, handler: (req: unknown) => unknown) => handlers.set(channel, handler),
  emit: (event: string, payload: unknown) => emitted.push({ event, payload })
}))

vi.mock('../ipc/data-events', () => ({ notifyDataChanged: vi.fn() }))

vi.mock('../db/db', () => ({
  getDb: () => {
    throw new Error('no db in this test')
  }
}))

vi.mock('../github/client', () => ({
  getGitHubClient: () => ({
    getStatus: () => status,
    onStatusChange: (l: (s: ConnectionStatus) => void) => {
      statusListeners.add(l)
      return () => statusListeners.delete(l)
    }
  })
}))

vi.mock('../auth', () => ({
  getAuthService: () => ({ getSession: () => ({ state: sessionState }) }),
  onAuthChanged: (l: () => void) => {
    authListeners.add(l)
    return () => authListeners.delete(l)
  }
}))

const { registerIpc } = await import('./actions.ipc')

describe('actions IPC', () => {
  afterEach(() => {
    handlers.clear()
    emitted.length = 0
    statusListeners.clear()
    authListeners.clear()
    status = 'online'
    sessionState = 'signed_in'
  })

  it('채널을 등록하고 가용성 변화를 이벤트로 보낸다', async () => {
    registerIpc()
    expect([...handlers.keys()].sort()).toEqual([
      'actions:getAvailability',
      'actions:markDone',
      'actions:markRead',
      'actions:star'
    ])
    expect(handlers.get('actions:getAvailability')?.(undefined)).toEqual({ available: true })

    status = 'offline'
    for (const l of statusListeners) l('offline')
    expect(emitted).toEqual([
      { event: 'actions:availability', payload: { available: false, reason: 'offline' } }
    ])

    // 막힌 동안의 요청은 DB 를 건드리지 않고 거절된다
    await expect(handlers.get('actions:star')?.({ repoId: 1, starred: true })).resolves.toEqual({
      ok: false,
      reason: 'offline'
    })

    status = 'online'
    sessionState = 'signed_out'
    for (const l of authListeners) l()
    expect(emitted.at(-1)).toEqual({
      event: 'actions:availability',
      payload: { available: false, reason: 'signed_out' }
    })
  })
})
