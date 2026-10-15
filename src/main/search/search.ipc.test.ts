import { describe, expect, it, vi } from 'vitest'
import type * as GitHubClientModule from '../github/client'

// IPC 등록이 서비스로 검색어를 넘기는지만 본다(검색 규칙은 search.service.test.ts).
const handlers = new Map<string, (req: unknown) => unknown>()

vi.mock('../ipc/registry', () => ({
  handle: (channel: string, handler: (req: unknown) => unknown) => handlers.set(channel, handler)
}))

vi.mock('../db/db', () => ({
  getDb: () => {
    throw new Error('no db in this test')
  }
}))

const get = vi.fn()
vi.mock('../github/client', async (importOriginal) => ({
  ...(await importOriginal<typeof GitHubClientModule>()),
  getGitHubClient: () => ({ getStatus: () => 'offline', get })
}))

const { registerIpc } = await import('./search.ipc')

describe('search IPC', () => {
  it('search:local·search:github 를 등록한다', async () => {
    registerIpc()
    expect([...handlers.keys()].sort()).toEqual(['search:github', 'search:local'])
    // 2자 미만은 DB 를 읽지 않는다
    expect(handlers.get('search:local')?.({ text: 'a' })).toEqual({
      repositories: [],
      pullRequests: [],
      issues: []
    })
    expect(handlers.get('search:local')?.(undefined)).toEqual({
      repositories: [],
      pullRequests: [],
      issues: []
    })
    // 오프라인이면 요청하지 않고 거절한다
    await expect(handlers.get('search:github')?.({ text: 'awesome' })).resolves.toEqual({
      status: 'offline'
    })
    expect(get).not.toHaveBeenCalled()
  })
})
