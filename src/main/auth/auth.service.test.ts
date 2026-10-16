import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AuthResult, SessionSnapshot } from '@shared/domain/session'
import { getLastUserId, setLastUserId } from '../db/account-meta'
import { registerFetchedDataCleaner, resetFetchedDataCleaners } from '../db/cleanup'
import { openDatabase } from '../db/connection'
import { listPins, pinRepo } from '../pins/pins.service'
import { isTestMode } from '../config'
import { createGitHubClientForTests } from '../github/client/testing'
import {
  AuthService,
  accountOpsFromDb,
  autoLoginForTests,
  type AccountOps,
  type AuthServiceOptions,
  type CredentialStore
} from './auth.service'
import { TokenStore, type SaveOutcome, type StoredCredential } from './token-store'
import {
  createFakeFetch,
  fakeSecretBackend,
  jsonResponse,
  userResponse,
  type FakeUser,
  type RecordedRequest
} from './test-helpers'

const API = 'https://api.github.example'
const WEB = 'https://github.example'

const TOKEN_A = 'ghp_AliceSecretToken000000000000000000'
const TOKEN_A2 = 'ghp_AliceSecondToken11111111111111111'
const TOKEN_B = 'ghp_BobSecretToken22222222222222222222'
const TOKEN_FG = 'github_pat_FineGrained333333333333333333'
const TOKEN_DEVICE = 'gho_DeviceSecretToken4444444444444444'
const TOKEN_BAD = 'ghp_BadToken5555555555555555555555555'
const ALL_TOKENS = [TOKEN_A, TOKEN_A2, TOKEN_B, TOKEN_FG, TOKEN_DEVICE, TOKEN_BAD]

const ALICE: FakeUser = { id: 1, login: 'alice', name: 'Alice', email: 'alice@example.com' }
const BOB: FakeUser = { id: 2, login: 'bob' }

const USERS: Record<string, { user: FakeUser; scopes: string | null }> = {
  [TOKEN_A]: { user: ALICE, scopes: 'repo, read:org, notifications' },
  [TOKEN_A2]: { user: ALICE, scopes: 'repo' },
  [TOKEN_B]: { user: BOB, scopes: 'repo, read:org, notifications' },
  [TOKEN_FG]: { user: BOB, scopes: null },
  [TOKEN_DEVICE]: { user: ALICE, scopes: 'repo, read:org, notifications' }
}

type DeviceScript = () => unknown

/** 가짜 GitHub: /user 는 토큰별 사용자, 기기 인증은 스크립트대로 응답 */
function fakeGitHub(deviceTokenResponses: DeviceScript[] = []) {
  let poll = 0
  return createFakeFetch((req: RecordedRequest) => {
    if (req.url.pathname === '/user') {
      const token = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
      const entry = USERS[token]
      if (!entry) return jsonResponse({ message: 'Bad credentials' }, { status: 401 })
      return userResponse(entry.user, entry.scopes)
    }
    if (req.url.pathname === '/login/device/code') {
      return jsonResponse({
        device_code: 'dev-code',
        user_code: 'WDJB-MJHT',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5
      })
    }
    if (req.url.pathname === '/login/oauth/access_token') {
      const step = deviceTokenResponses[Math.min(poll, deviceTokenResponses.length - 1)]
      poll++
      return jsonResponse(step ? step() : { error: 'authorization_pending' })
    }
    return new Response('not found', { status: 404 })
  })
}

class MemoryStore implements CredentialStore {
  saved: StoredCredential | null = null
  outcome: SaveOutcome = 'encrypted'
  choice: string | null = null
  load(): StoredCredential | null {
    return this.saved
  }
  save(cred: StoredCredential): SaveOutcome {
    if (this.outcome === 'encrypted' || this.outcome === 'insecure_file') this.saved = cred
    return this.outcome
  }
  clear(): void {
    this.saved = null
  }
  setInsecureChoice(choice: 'save' | 'memory'): void {
    this.choice = choice
    this.outcome = choice === 'save' ? 'insecure_file' : 'memory'
  }
}

/** 호출 순서를 기록하는 계정 작업(실제 DB 위에서) */
function recordingAccount(db: DatabaseSync, log: string[]): AccountOps {
  const real = accountOpsFromDb(() => db)
  return {
    isDifferentAccount: (id) => real.isDifferentAccount(id),
    setLastUserId: (id) => {
      log.push(`setLastUserId:${id}`)
      real.setLastUserId(id)
    },
    clearAccountData: () => {
      log.push('clearAccountData')
      real.clearAccountData()
    },
    clearFetchedData: () => {
      log.push('clearFetchedData')
      real.clearFetchedData()
    }
  }
}

/** 기다리는 동안 다른 작업이 돌 수 있게 비동기 큐를 비운다 */
async function until(check: () => boolean, label = 'condition'): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await new Promise((r) => setImmediate(r))
  }
  throw new Error(`timed out waiting for ${label}`)
}

describe('AuthService', () => {
  let db: DatabaseSync
  let log: string[]
  let store: MemoryStore
  let snapshots: SessionSnapshot[]
  let results: unknown[]

  function makeService(
    overrides: Partial<AuthServiceOptions> = {},
    github = fakeGitHub()
  ): { service: AuthService; calls: RecordedRequest[] } {
    const service = new AuthService({
      store,
      account: recordingAccount(db, log),
      clientId: '',
      apiBase: API,
      webBase: WEB,
      fetch: github.fetch,
      now: () => 1_000_000,
      sleep: async () => {},
      ...overrides
    })
    service.onChange((s) => snapshots.push(s))
    service.init()
    return { service, calls: github.calls }
  }

  async function record<T>(p: Promise<T> | T): Promise<T> {
    const value = await p
    results.push(value)
    return value
  }

  beforeEach(() => {
    db = openDatabase(':memory:')
    log = []
    store = new MemoryStore()
    snapshots = []
    results = []
    resetFetchedDataCleaners()
    db.exec('CREATE TABLE fake_cache (x INTEGER)')
    db.exec('INSERT INTO fake_cache VALUES (1)')
    registerFetchedDataCleaner((d) => d.exec('DELETE FROM fake_cache'))
  })

  afterEach(() => {
    // 어떤 화면 전달 값에도 토큰이 들어가면 안 된다
    const payload = JSON.stringify({ snapshots, results })
    for (const token of ALL_TOKENS) expect(payload).not.toContain(token)
    resetFetchedDataCleaners()
    db.close()
  })

  function cacheRows(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM fake_cache').get() as { n: number }).n
  }

  it('저장된 토큰이 없으면 signed_out 으로 시작한다', () => {
    const { service } = makeService()
    expect(service.getSession()).toMatchObject({
      state: 'signed_out',
      user: null,
      tokenKind: null,
      missingScopes: [],
      inboxAvailable: false
    })
    expect(service.getToken()).toBeNull()
  })

  it('저장된 토큰이 있으면 네트워크 없이 signed_in 으로 시작한다', () => {
    store.saved = {
      token: TOKEN_A,
      tokenKind: 'classic',
      user: { id: 1, login: 'alice', name: 'Alice', avatarUrl: 'x', email: null },
      scopes: ['repo']
    }
    const { service, calls } = makeService()
    const session = service.getSession()
    expect(session.state).toBe('signed_in')
    expect(session.user?.login).toBe('alice')
    expect(session.missingScopes.map((m) => m.scope)).toEqual(['read:org'])
    expect(service.getToken()).toBe(TOKEN_A)
    expect(calls).toHaveLength(0)
  })

  describe('토큰 입력 로그인', () => {
    it('첫 로그인: 사용자 ID 를 기록하고 토큰을 저장하고 세션을 푼다', async () => {
      const { service } = makeService()
      let resets = 0
      service.attachClient({
        onStatusChange: () => () => {},
        resetSession: () => {
          resets++
        },
        get: () => Promise.reject(new Error('unused'))
      })
      const result = await record(service.loginWithToken(`  ${TOKEN_A}\n`))
      expect(result.ok).toBe(true)
      expect(result.session).toMatchObject({
        state: 'signed_in',
        user: {
          id: 1,
          login: 'alice',
          name: 'Alice',
          avatarUrl: 'https://avatars.example/u/1',
          email: 'alice@example.com'
        },
        tokenKind: 'classic',
        missingScopes: [],
        inboxAvailable: true
      })
      expect(log).toEqual(['setLastUserId:1'])
      expect(getLastUserId(db)).toBe(1)
      expect(store.saved?.token).toBe(TOKEN_A)
      // 공개 이메일도 다른 사용자 정보와 함께 저장한다
      expect(store.saved?.user.email).toBe('alice@example.com')
      expect(service.getToken()).toBe(TOKEN_A)
      expect(resets).toBe(1)
      expect(snapshots.map((s) => s.state)).toEqual(['signing_in', 'signed_in'])
    })

    it('다른 계정이면 clearAccountData 를 setLastUserId 보다 먼저 부른다', async () => {
      setLastUserId(db, 1)
      pinRepo(db, 10)
      const { service } = makeService()
      await record(service.loginWithToken(TOKEN_B))
      expect(log).toEqual(['clearAccountData', 'setLastUserId:2'])
      expect(listPins(db)).toEqual([])
      expect(cacheRows()).toBe(0)
      expect(getLastUserId(db)).toBe(2)
    })

    it('같은 계정이면 clearAccountData 를 부르지 않는다', async () => {
      setLastUserId(db, 1)
      pinRepo(db, 10)
      const { service } = makeService()
      await record(service.loginWithToken(TOKEN_A2))
      expect(log).toEqual(['setLastUserId:1'])
      expect(listPins(db)).toHaveLength(1)
      expect(cacheRows()).toBe(1)
    })

    it('권한이 빠져도 로그인하고, 빠진 권한과 영향을 알려 준다', async () => {
      const { service } = makeService()
      const result = await record(service.loginWithToken(TOKEN_A2))
      expect(result.ok).toBe(true)
      expect(result.session.missingScopes).toEqual([
        { scope: 'read:org', impact: 'org_repos_and_team_reviews' }
      ])
      expect(result.session.inboxAvailable).toBe(true)
    })

    it('세분화 토큰은 받되 Inbox 를 쓸 수 없다고 표시한다', async () => {
      const { service } = makeService()
      const result = await record(service.loginWithToken(TOKEN_FG))
      expect(result.ok).toBe(true)
      expect(result.session.tokenKind).toBe('fine_grained')
      expect(result.session.inboxAvailable).toBe(false)
    })

    it('잘못된 토큰이면 실패를 돌려주고 아무것도 바꾸지 않는다', async () => {
      setLastUserId(db, 1)
      const { service } = makeService()
      const result = await record(service.loginWithToken(TOKEN_BAD))
      expect(result).toMatchObject({ ok: false, error: 'invalid_token' })
      expect(result.session.state).toBe('signed_out')
      expect(log).toEqual([])
      expect(store.saved).toBeNull()
      expect(service.getToken()).toBeNull()
      expect(getLastUserId(db)).toBe(1)
    })

    it('빈 토큰은 요청 없이 거절한다', async () => {
      const { service, calls } = makeService()
      expect(await record(service.loginWithToken('   '))).toMatchObject({
        ok: false,
        error: 'empty_token'
      })
      expect(calls).toHaveLength(0)
    })

    it('네트워크 실패는 offline 으로 구분하고 토큰을 오류에 싣지 않는다', async () => {
      const github = createFakeFetch(() => {
        throw new TypeError(`ECONNREFUSED Bearer ${TOKEN_A}`)
      })
      const { service } = makeService({ fetch: github.fetch })
      const result = await record(service.loginWithToken(TOKEN_A))
      expect(result).toMatchObject({ ok: false, error: 'offline' })
    })
  })

  describe('세션 만료(401)', () => {
    it('클라이언트가 401 을 받으면 expired 가 되고 사용자 정보는 남는다. 다시 로그인하면 풀린다', async () => {
      const { service } = makeService()
      let serverToken = TOKEN_A
      const api = createFakeFetch((req) => {
        const token = req.headers.get('authorization')?.replace(/^Bearer /, '')
        return token === serverToken
          ? jsonResponse({ ok: true })
          : jsonResponse({ message: 'Bad credentials' }, { status: 401 })
      })
      const client = createGitHubClientForTests({
        tokenProvider: () => service.getToken(),
        fetch: api.fetch,
        baseUrl: API
      })
      service.attachClient(client)
      await record(service.loginWithToken(TOKEN_A))
      await client.get('/repos/a/b')

      serverToken = 'revoked'
      await expect(client.get('/repos/a/b')).rejects.toThrow()
      expect(client.getStatus()).toBe('session_expired')
      expect(service.getSession()).toMatchObject({ state: 'expired', user: { id: 1 } })
      expect(store.saved?.token).toBe(TOKEN_A)

      serverToken = TOKEN_A2
      const relog = await record(service.loginWithToken(TOKEN_A2))
      expect(relog.session.state).toBe('signed_in')
      expect(client.getStatus()).toBe('online')
      expect(log).toEqual(['setLastUserId:1', 'setLastUserId:1'])
      client.dispose()
    })

    it('만료 상태에서 재로그인에 실패하면 expired 로 돌아간다', async () => {
      const { service } = makeService()
      let listener: ((s: 'online' | 'session_expired') => void) | undefined
      service.attachClient({
        onStatusChange: (l) => {
          listener = l
          return () => {}
        },
        resetSession: () => {},
        get: () => Promise.reject(new Error('unused'))
      })
      await record(service.loginWithToken(TOKEN_A))
      listener?.('session_expired')
      expect(service.getSession().state).toBe('expired')
      const result = await record(service.loginWithToken(TOKEN_BAD))
      expect(result.ok).toBe(false)
      expect(result.session).toMatchObject({ state: 'expired', user: { id: 1 } })
    })
  })

  describe('로그아웃', () => {
    it('가져온 정보와 토큰을 지우고 signed_out. 고정·마지막 사용자 ID 는 남긴다', async () => {
      const { service } = makeService()
      await record(service.loginWithToken(TOKEN_A))
      pinRepo(db, 10)
      log.length = 0

      const session = await record(service.logout())
      expect(session).toMatchObject({ state: 'signed_out', user: null, tokenKind: null })
      expect(log).toEqual(['clearFetchedData'])
      expect(cacheRows()).toBe(0)
      expect(store.saved).toBeNull()
      expect(service.getToken()).toBeNull()
      expect(listPins(db)).toHaveLength(1)
      expect(getLastUserId(db)).toBe(1)
    })

    it('로그아웃 후 같은 계정으로 다시 들어오면 고정을 지우지 않는다', async () => {
      const { service } = makeService()
      await record(service.loginWithToken(TOKEN_A))
      pinRepo(db, 10)
      service.logout()
      await record(service.loginWithToken(TOKEN_A))
      expect(listPins(db)).toHaveLength(1)
      expect(log).not.toContain('clearAccountData')
    })

    it('검증 중에 로그아웃하면 늦게 끝난 로그인은 버린다', async () => {
      let release: () => void = () => {}
      const gate = new Promise<void>((r) => (release = r))
      const github = createFakeFetch(async () => {
        await gate
        return userResponse(ALICE, 'repo')
      })
      const { service } = makeService({ fetch: github.fetch })
      const pending = service.loginWithToken(TOKEN_A)
      service.logout()
      release()
      const result = await record(pending)
      expect(result).toMatchObject({ ok: false, error: 'cancelled' })
      expect(service.getSession().state).toBe('signed_out')
      expect(service.getToken()).toBeNull()
      expect(store.saved).toBeNull()
    })
  })

  describe('브라우저 코드 로그인(기기 인증)', () => {
    it('client ID 가 없으면 숨기고 시작하지 않는다', async () => {
      const { service, calls } = makeService({ clientId: '' })
      expect(service.getSession().deviceFlowAvailable).toBe(false)
      const result = await record(service.startDeviceFlow())
      expect(result).toMatchObject({ ok: false, error: 'device_flow_unavailable' })
      expect(calls).toHaveLength(0)
    })

    it('코드를 보여 주고, 승인되면 oauth 토큰으로 로그인한다', async () => {
      const github = fakeGitHub([
        () => ({ error: 'authorization_pending' }),
        () => ({ error: 'slow_down' }),
        () => ({ access_token: TOKEN_DEVICE, token_type: 'bearer' })
      ])
      const { service } = makeService({ clientId: 'Iv1.public' }, github)
      expect(service.getSession().deviceFlowAvailable).toBe(true)

      const started = await record(service.startDeviceFlow())
      expect(started.ok).toBe(true)
      expect(snapshots.some((s) => s.deviceFlow?.status === 'pending')).toBe(true)
      const pending = snapshots.find((s) => s.deviceFlow?.status === 'pending')
      expect(pending?.deviceFlow).toEqual({
        userCode: 'WDJB-MJHT',
        verificationUri: 'https://github.com/login/device',
        expiresAt: 1_000_000 + 900_000,
        status: 'pending'
      })
      expect(pending?.state).toBe('signing_in')

      await until(() => service.getSession().state === 'signed_in', 'signed_in')
      const session = service.getSession()
      expect(session.tokenKind).toBe('oauth')
      expect(session.deviceFlow).toBeUndefined()
      expect(service.getToken()).toBe(TOKEN_DEVICE)
      expect(store.saved?.tokenKind).toBe('oauth')
      expect(github.calls.some((c) => c.body.includes('secret'))).toBe(false)
    })

    it('거부하면 denied 상태를 보여 주고 signed_out 으로 돌아간다', async () => {
      const github = fakeGitHub([() => ({ error: 'access_denied' })])
      const { service } = makeService({ clientId: 'Iv1.public' }, github)
      await record(service.startDeviceFlow())
      await until(() => service.getSession().deviceFlow?.status === 'denied', 'denied')
      expect(service.getSession().state).toBe('signed_out')
      expect(service.getToken()).toBeNull()
    })

    it('코드가 만료되면 expired 상태를 보여 준다', async () => {
      const github = fakeGitHub([() => ({ error: 'expired_token' })])
      const { service } = makeService({ clientId: 'Iv1.public' }, github)
      await record(service.startDeviceFlow())
      await until(() => service.getSession().deviceFlow?.status === 'expired', 'expired')
      expect(service.getSession().state).toBe('signed_out')
    })

    it('취소하면 cancelled 이고, 그 뒤 승인 응답은 무시한다', async () => {
      let wake: () => void = () => {}
      const github = fakeGitHub([() => ({ access_token: TOKEN_DEVICE })])
      const { service } = makeService(
        {
          clientId: 'Iv1.public',
          sleep: (_ms, signal) =>
            new Promise<void>((resolve) => {
              wake = resolve
              signal.addEventListener('abort', () => resolve(), { once: true })
            })
        },
        github
      )
      await record(service.startDeviceFlow())
      const session = await record(service.cancelDeviceFlow())
      expect(session.deviceFlow?.status).toBe('cancelled')
      expect(session.state).toBe('signed_out')
      wake()
      await new Promise((r) => setTimeout(r, 5))
      expect(service.getSession().state).toBe('signed_out')
      expect(service.getToken()).toBeNull()
      expect(
        github.calls.filter((c) => c.url.pathname === '/login/oauth/access_token')
      ).toHaveLength(0)
    })

    it('인증 주소는 안전한 외부 열기로만 연다', async () => {
      const github = fakeGitHub([() => ({ error: 'authorization_pending' })])
      const { service } = makeService(
        { clientId: 'Iv1.public', sleep: () => new Promise<void>(() => {}) },
        github
      )
      const opened: string[] = []
      const open = async (url: string) => {
        opened.push(url)
      }
      expect(await record(service.openVerificationUri(open))).toEqual({ opened: false })
      await record(service.startDeviceFlow())
      expect(await record(service.openVerificationUri(open))).toEqual({ opened: true })
      expect(opened).toEqual(['https://github.com/login/device'])
      service.cancelDeviceFlow()
    })

    it('위험한 인증 주소는 열지 않는다', async () => {
      const github = createFakeFetch(() =>
        jsonResponse({
          device_code: 'd',
          user_code: 'X',
          verification_uri: 'javascript:alert(1)',
          expires_in: 900,
          interval: 5
        })
      )
      const { service } = makeService(
        { clientId: 'Iv1.public', fetch: github.fetch, sleep: () => new Promise<void>(() => {}) },
        github
      )
      await record(service.startDeviceFlow())
      const opened: string[] = []
      expect(
        await record(
          service.openVerificationUri(async (u) => {
            opened.push(u)
          })
        )
      ).toEqual({ opened: false })
      expect(opened).toEqual([])
      service.cancelDeviceFlow()
    })

    it('기기 인증 중 토큰으로 로그인하면 기기 인증을 멈춘다', async () => {
      const github = fakeGitHub([() => ({ access_token: TOKEN_DEVICE })])
      let aborted = false
      const { service } = makeService(
        {
          clientId: 'Iv1.public',
          sleep: (_ms, signal) =>
            new Promise<void>((resolve) => {
              signal.addEventListener(
                'abort',
                () => {
                  aborted = true
                  resolve()
                },
                { once: true }
              )
            })
        },
        github
      )
      await record(service.startDeviceFlow())
      const result = await record(service.loginWithToken(TOKEN_A))
      expect(result.ok).toBe(true)
      expect(aborted).toBe(true)
      expect(service.getToken()).toBe(TOKEN_A)
      expect(service.getSession().deviceFlow).toBeUndefined()
    })
  })

  describe('리눅스 약한 암호화', () => {
    let dir: string
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'gdesk-auth-svc-'))
    })
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    const linuxStore = () =>
      new TokenStore({
        dir,
        backend: fakeSecretBackend({
          platform: 'linux',
          getSelectedStorageBackend: () => 'basic_text'
        })
      })

    function makeLinux(): AuthService {
      const service = new AuthService({
        store: linuxStore(),
        account: recordingAccount(db, log),
        clientId: '',
        apiBase: API,
        webBase: WEB,
        fetch: fakeGitHub().fetch
      })
      service.onChange((s) => snapshots.push(s))
      service.init()
      return service
    }

    it('로그인 뒤 저장 방법을 묻고, (a) 를 고르면 0600 파일에 저장해 다음 실행에도 쓴다', async () => {
      const service = makeLinux()
      const result = await record(service.loginWithToken(TOKEN_A))
      expect(result.session).toMatchObject({ state: 'signed_in', storagePrompt: 'linux_insecure' })
      expect(service.getToken()).toBe(TOKEN_A)
      const plainPath = linuxStore().plainPath
      expect(existsSync(plainPath)).toBe(false)

      const chosen = await record(service.chooseInsecureStorage('save'))
      expect(chosen.storagePrompt).toBeUndefined()
      expect(statSync(plainPath).mode & 0o777).toBe(0o600)

      const next = makeLinux()
      expect(next.getSession().state).toBe('signed_in')
      expect(next.getToken()).toBe(TOKEN_A)
      const relog = await record(next.loginWithToken(TOKEN_A))
      expect(relog.session.storagePrompt).toBeUndefined()
    })

    it('(b) 를 고르면 저장하지 않고, 다음 실행에서 다시 로그인한다. 다시 묻지 않는다', async () => {
      const service = makeLinux()
      await record(service.loginWithToken(TOKEN_A))
      const chosen = await record(service.chooseInsecureStorage('memory'))
      expect(chosen.storagePrompt).toBeUndefined()
      expect(chosen.state).toBe('signed_in')
      expect(service.getToken()).toBe(TOKEN_A)
      expect(existsSync(linuxStore().plainPath)).toBe(false)

      const next = makeLinux()
      expect(next.getSession().state).toBe('signed_out')
      const relog = await record(next.loginWithToken(TOKEN_A))
      expect(relog.session.storagePrompt).toBeUndefined()
      expect(existsSync(linuxStore().plainPath)).toBe(false)
    })

    it('로그아웃하면 0600 파일도 지운다', async () => {
      const service = makeLinux()
      await record(service.loginWithToken(TOKEN_A))
      service.chooseInsecureStorage('save')
      service.logout()
      expect(existsSync(linuxStore().plainPath)).toBe(false)
    })
  })

  describe('시작 시 재확인', () => {
    it('저장된 토큰으로 /user 를 다시 확인해 권한 정보를 갱신한다', async () => {
      store.saved = {
        token: TOKEN_A,
        tokenKind: 'classic',
        user: { id: 1, login: 'old-login', name: null, avatarUrl: 'x', email: null },
        scopes: []
      }
      const { service } = makeService()
      const client = createGitHubClientForTests({
        tokenProvider: () => service.getToken(),
        fetch: fakeGitHub().fetch,
        baseUrl: API
      })
      service.attachClient(client)
      await service.revalidate()
      expect(service.getSession()).toMatchObject({
        state: 'signed_in',
        user: { login: 'alice', email: 'alice@example.com' },
        missingScopes: []
      })
      client.dispose()
    })

    it('재확인에서 401 이면 expired', async () => {
      store.saved = {
        token: TOKEN_BAD,
        tokenKind: 'classic',
        user: { id: 1, login: 'alice', name: null, avatarUrl: 'x', email: null },
        scopes: ['repo']
      }
      const { service } = makeService()
      const client = createGitHubClientForTests({
        tokenProvider: () => service.getToken(),
        fetch: fakeGitHub().fetch,
        baseUrl: API
      })
      service.attachClient(client)
      await service.revalidate()
      expect(service.getSession()).toMatchObject({ state: 'expired', user: { id: 1 } })
      client.dispose()
    })
  })

  describe('테스트 모드 자동 로그인', () => {
    it('테스트 모드가 아니면 GDESK_TEST_TOKEN 을 무시한다', async () => {
      const { service, calls } = makeService()
      const result = await autoLoginForTests(service, {
        testMode: false,
        env: { GDESK_TEST_TOKEN: TOKEN_A }
      })
      expect(result).toBeNull()
      expect(calls).toHaveLength(0)
      expect(service.getSession().state).toBe('signed_out')
    })

    it('배포 빌드 조건(vitest)에서는 isTestMode 가 거짓이라 자동 로그인하지 않는다', async () => {
      const env = { GDESK_TEST_MODE: '1', GDESK_TEST_TOKEN: TOKEN_A }
      expect(isTestMode(env)).toBe(false)
      const { service, calls } = makeService()
      expect(await autoLoginForTests(service, { testMode: isTestMode(env), env })).toBeNull()
      expect(calls).toHaveLength(0)
    })

    it('테스트 모드면 일반 검증 경로(GET /user)로 로그인하고, 저장하지 않는다', async () => {
      const { service, calls } = makeService()
      const result = await record(
        autoLoginForTests(service, { testMode: true, env: { GDESK_TEST_TOKEN: TOKEN_A } })
      )
      expect((result as AuthResult).ok).toBe(true)
      expect(calls.map((c) => c.url.pathname)).toEqual(['/user'])
      expect(service.getSession().state).toBe('signed_in')
      expect(service.getToken()).toBe(TOKEN_A)
      expect(store.saved).toBeNull()
      expect(log).toEqual(['setLastUserId:1'])
    })

    it('테스트 모드여도 토큰이 없으면 아무것도 하지 않는다', async () => {
      const { service } = makeService()
      expect(await autoLoginForTests(service, { testMode: true, env: {} })).toBeNull()
    })
  })
})
