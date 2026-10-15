import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SaveOutcome, StoredCredential } from './token-store'
import { createFakeFetch, jsonResponse, userResponse } from './test-helpers'

// 화면으로 가는 모든 값(IPC 응답·이벤트)을 가로채 토큰이 없는지 본다.
const handlers = new Map<string, (req: unknown) => unknown>()
const emitted: { event: string; payload: unknown }[] = []
const openedUrls: string[] = []

vi.mock('electron', () => ({
  shell: {
    openExternal: async (url: string) => {
      openedUrls.push(url)
    }
  }
}))

vi.mock('../ipc/registry', () => ({
  handle: (channel: string, handler: (req: unknown) => unknown) => handlers.set(channel, handler),
  emit: (event: string, payload: unknown) => emitted.push({ event, payload })
}))

const { registerIpc } = await import('./auth.ipc')
const { getToken, initAuth, resetAuthForTests, startAuth, tokenProvider } = await import('./index')

const TOKEN = 'ghp_IpcSecretToken99999999999999999999'
const DEVICE_TOKEN = 'gho_IpcDeviceToken8888888888888888888'

class MemoryStore {
  saved: StoredCredential | null = null
  load = () => this.saved
  save = (c: StoredCredential): SaveOutcome => {
    this.saved = c
    return 'encrypted'
  }
  clear = () => {
    this.saved = null
  }
  setInsecureChoice = () => {}
}

const account = {
  isDifferentAccount: () => false,
  setLastUserId: () => {},
  clearAccountData: () => {},
  clearFetchedData: () => {}
}

function api() {
  return createFakeFetch((req) => {
    const auth = req.headers.get('authorization')
    if (req.url.pathname === '/user') {
      if (auth === `Bearer ${TOKEN}` || auth === `Bearer ${DEVICE_TOKEN}`) {
        return userResponse({ id: 5, login: 'ipc-user' }, 'repo, read:org, notifications')
      }
      return jsonResponse({ message: `Bad credentials for ${auth}` }, { status: 401 })
    }
    if (req.url.pathname === '/login/device/code') {
      return jsonResponse({
        device_code: 'dc',
        user_code: 'AAAA-BBBB',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5
      })
    }
    return jsonResponse({ access_token: DEVICE_TOKEN })
  })
}

async function invoke(channel: string, req?: unknown): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return handler(req)
}

describe('auth IPC', () => {
  const responses: unknown[] = []

  beforeEach(() => {
    handlers.clear()
    emitted.length = 0
    responses.length = 0
    resetAuthForTests()
  })

  afterEach(() => {
    const everything = JSON.stringify({ responses, emitted })
    expect(everything).not.toContain(TOKEN)
    expect(everything).not.toContain(DEVICE_TOKEN)
    expect(everything).not.toContain('ghp_')
    expect(everything).not.toContain('gho_')
    resetAuthForTests()
  })

  it('모든 채널을 등록한다', () => {
    registerIpc()
    expect([...handlers.keys()].sort()).toEqual(
      [
        'auth:cancelDeviceFlow',
        'auth:chooseInsecureStorage',
        'auth:getSession',
        'auth:loginWithToken',
        'auth:logout',
        'auth:openVerificationUri',
        'auth:startDeviceFlow'
      ].sort()
    )
  })

  it('토큰 입력·로그아웃·실패 경로의 응답과 이벤트에 토큰이 없다', async () => {
    registerIpc()
    initAuth({ store: new MemoryStore(), account, fetch: api().fetch, clientId: '' })

    responses.push(await invoke('auth:getSession'))
    responses.push(
      await invoke('auth:loginWithToken', { token: 'ghp_wrong000000000000000000000000' })
    )
    responses.push(await invoke('auth:loginWithToken', { token: TOKEN }))
    expect(getToken()).toBe(TOKEN)
    expect(await tokenProvider()).toBe(TOKEN)
    responses.push(await invoke('auth:getSession'))
    responses.push(await invoke('auth:chooseInsecureStorage', { choice: 'memory' }))
    responses.push(await invoke('auth:logout'))
    expect(getToken()).toBeNull()

    expect(emitted.length).toBeGreaterThan(0)
    expect(emitted.every((e) => e.event === 'auth:changed')).toBe(true)
  })

  it('기기 인증 경로의 응답과 이벤트에도 토큰이 없다', async () => {
    registerIpc()
    const fake = api()
    initAuth({
      store: new MemoryStore(),
      account,
      fetch: fake.fetch,
      clientId: 'Iv1.public',
      sleep: async () => {}
    })
    responses.push(await invoke('auth:startDeviceFlow'))
    for (let i = 0; i < 50 && getToken() === null; i++) {
      await new Promise((r) => setImmediate(r))
    }
    expect(getToken()).toBe(DEVICE_TOKEN)
    responses.push(await invoke('auth:getSession'))
    responses.push(await invoke('auth:cancelDeviceFlow'))
    responses.push(await invoke('auth:openVerificationUri'))
  })

  it('인증 주소 열기는 shell.openExternal 을 거친다', async () => {
    registerIpc()
    initAuth({
      store: new MemoryStore(),
      account,
      fetch: api().fetch,
      clientId: 'Iv1.public',
      sleep: () => new Promise<void>(() => {})
    })
    openedUrls.length = 0
    responses.push(await invoke('auth:startDeviceFlow'))
    responses.push(await invoke('auth:openVerificationUri'))
    expect(openedUrls).toEqual(['https://github.com/login/device'])
    responses.push(await invoke('auth:cancelDeviceFlow'))
  })

  it('startAuth 는 테스트 모드가 아니면 GDESK_TEST_TOKEN 으로 로그인하지 않는다', async () => {
    registerIpc()
    const fake = api()
    initAuth({ store: new MemoryStore(), account, fetch: fake.fetch })
    await startAuth(
      {
        onStatusChange: () => () => {},
        resetSession: () => {},
        get: () => Promise.reject(new Error('x'))
      },
      { env: { GDESK_TEST_MODE: '1', GDESK_TEST_TOKEN: TOKEN } }
    )
    expect(getToken()).toBeNull()
    expect(fake.calls).toHaveLength(0)
  })

  it('초기화 전 getToken 은 null', () => {
    expect(getToken()).toBeNull()
  })
})
