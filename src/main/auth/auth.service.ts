import type { DatabaseSync } from 'node:sqlite'
import type { ConnectionStatus } from '@shared/domain/connection'
import type {
  AuthErrorCode,
  AuthResult,
  DeviceFlowProgress,
  DeviceFlowStatus,
  InsecureStorageChoice,
  SessionSnapshot,
  SessionState,
  StoragePrompt
} from '@shared/domain/session'
import { isDifferentAccount, setLastUserId } from '../db/account-meta'
import { clearAccountData, clearFetchedData } from '../db/cleanup'
import { openExternalSafe } from '../app/external'
import {
  DeviceFlowError,
  defaultSleep,
  pollForToken,
  requestDeviceCode,
  type DeviceCode,
  type DeviceFlowDeps,
  type Sleep
} from './device-flow'
import type { SaveOutcome, StoredCredential } from './token-store'
import {
  TokenValidationError,
  computeMissingScopes,
  detectTokenKind,
  isInboxAvailable,
  parseScopes,
  parseUser,
  validateToken,
  type ValidatedToken
} from './token-validate'

/**
 * 로그인 세션(spec §5). 메인 프로세스 전용.
 * - 토큰은 이 객체 안에만 있다. 화면으로 가는 값(SessionSnapshot·AuthResult)에는 담지 않는다.
 * - 401(클라이언트 상태 session_expired) → expired. 캐시는 읽기 전용으로 계속 보인다.
 * - 로그아웃 → 토큰 삭제 + clearFetchedData. 마지막 사용자 ID 는 남긴다.
 * - 로그인 성공 → 다른 계정이면 clearAccountData 먼저, 그다음 setLastUserId·토큰 저장·resetSession.
 * 디스크의 클론 폴더는 건드리지 않는다.
 */

/** 계정 단위 DB 작업. 테스트에서 호출 순서를 확인할 수 있게 주입한다. */
export interface AccountOps {
  isDifferentAccount(userId: number): boolean
  setLastUserId(userId: number): void
  clearAccountData(): void
  clearFetchedData(): void
}

export function accountOpsFromDb(getDb: () => DatabaseSync): AccountOps {
  return {
    isDifferentAccount: (userId) => isDifferentAccount(getDb(), userId),
    setLastUserId: (userId) => setLastUserId(getDb(), userId),
    clearAccountData: () => clearAccountData(getDb()),
    clearFetchedData: () => clearFetchedData(getDb())
  }
}

/** TokenStore 의 필요한 부분 */
export interface CredentialStore {
  load(): StoredCredential | null
  save(cred: StoredCredential): SaveOutcome
  clear(): void
  setInsecureChoice(choice: InsecureStorageChoice): void
}

/** GitHubClient 의 필요한 부분 */
export interface SessionClient {
  onStatusChange(listener: (status: ConnectionStatus) => void): () => void
  resetSession(): void
  get<T = unknown>(path: string): Promise<{ data: T; headers: Headers }>
}

export interface AuthServiceOptions {
  store: CredentialStore
  account: AccountOps
  /** 공개 client ID. 비어 있으면 기기 인증을 숨긴다 */
  clientId: string
  /** githubApiBase() */
  apiBase: string
  /** githubWebBase() */
  webBase: string
  fetch?: typeof fetch
  now?: () => number
  sleep?: Sleep
}

export interface LoginOptions {
  /** false 면 저장하지 않는다(테스트 모드 자동 로그인). 기본 true */
  persist?: boolean
}

type SettledState = Exclude<SessionState, 'signing_in'>

export class AuthService {
  private readonly store: CredentialStore
  private readonly account: AccountOps
  private readonly clientId: string
  private readonly apiBase: string
  private readonly fetchFn: typeof fetch
  private readonly deviceDeps: DeviceFlowDeps

  private token: string | null = null
  private cred: Omit<StoredCredential, 'token'> | null = null
  private state: SessionState = 'signed_out'
  /** 로그인 시도가 실패·취소되면 돌아갈 상태 */
  private restoreState: SettledState = 'signed_out'
  private deviceFlow: DeviceFlowProgress | undefined
  private storagePrompt: StoragePrompt | undefined
  /** 로그인 시도 번호. 늦게 끝난 시도(로그아웃·취소·새 시도 뒤)를 버리는 데 쓴다 */
  private attempt = 0
  private deviceAbort: AbortController | null = null
  private client: SessionClient | null = null
  private unsubscribeClient: (() => void) | null = null
  private readonly listeners = new Set<(session: SessionSnapshot) => void>()

  constructor(options: AuthServiceOptions) {
    this.store = options.store
    this.account = options.account
    this.clientId = options.clientId
    this.apiBase = options.apiBase
    this.fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.deviceDeps = {
      fetch: this.fetchFn,
      webBase: options.webBase,
      clientId: options.clientId,
      now: options.now ?? Date.now,
      sleep: options.sleep ?? defaultSleep
    }
  }

  // ───────────────────────── 조회 ─────────────────────────

  /** 메인 프로세스 전용. IPC 로 보내지 않는다. */
  getToken(): string | null {
    return this.token
  }

  getSession(): SessionSnapshot {
    const cred = this.cred
    const missingScopes = cred ? computeMissingScopes(cred.scopes, cred.tokenKind) : []
    const snapshot: SessionSnapshot = {
      state: this.state,
      user: cred ? { ...cred.user } : null,
      tokenKind: cred?.tokenKind ?? null,
      missingScopes,
      inboxAvailable: cred ? isInboxAvailable(cred.tokenKind, missingScopes) : false,
      deviceFlowAvailable: this.clientId !== ''
    }
    if (this.deviceFlow) snapshot.deviceFlow = { ...this.deviceFlow }
    if (this.storagePrompt) snapshot.storagePrompt = this.storagePrompt
    return snapshot
  }

  /** 세션이 바뀔 때마다 알린다. 돌려준 함수로 구독을 끊는다. */
  onChange(listener: (session: SessionSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // ───────────────────────── 시작 ─────────────────────────

  /** 저장된 토큰을 읽는다. 네트워크 없이 signed_in 으로 시작할 수 있다(확인은 revalidate). */
  init(): SessionSnapshot {
    let stored: StoredCredential | null
    try {
      stored = this.store.load()
    } catch {
      stored = null
    }
    if (stored) {
      const { token, ...rest } = stored
      this.token = token
      this.cred = rest
      this.state = 'signed_in'
      this.restoreState = 'signed_in'
    }
    return this.getSession()
  }

  /** GitHub 클라이언트의 연결 상태를 구독한다(401 → expired). */
  attachClient(client: SessionClient): void {
    this.unsubscribeClient?.()
    this.client = client
    this.unsubscribeClient = client.onStatusChange((status) => {
      if (status === 'session_expired') this.markExpired()
    })
  }

  /** 저장된 토큰으로 GET /user 를 다시 물어 사용자·권한을 갱신한다. 401 이면 클라이언트를 거쳐 expired. */
  async revalidate(): Promise<void> {
    const client = this.client
    const token = this.token
    if (!client || !token || !this.cred || this.state !== 'signed_in') return
    const attempt = this.attempt
    let res: { data: unknown; headers: Headers }
    try {
      res = await client.get<unknown>('/user')
    } catch {
      // 401 은 상태 구독으로 처리된다. 오프라인이면 저장된 정보를 그대로 쓴다.
      return
    }
    if (attempt !== this.attempt || this.token !== token || !this.cred) return
    const user = parseUser(res.data)
    if (!user || user.id !== this.cred.user.id) return
    const header = res.headers.get('x-oauth-scopes')
    const tokenKind =
      this.cred.tokenKind === 'oauth' ? 'oauth' : detectTokenKind(token, header, undefined)
    this.cred = { user, tokenKind, scopes: parseScopes(header) }
    this.emit()
  }

  // ───────────────────────── 토큰 입력 ─────────────────────────

  async loginWithToken(rawToken: string, options: LoginOptions = {}): Promise<AuthResult> {
    const token = typeof rawToken === 'string' ? rawToken.trim() : ''
    if (token === '') return this.fail('empty_token')
    const attempt = this.beginAttempt()
    this.deviceFlow = undefined
    this.state = 'signing_in'
    this.emit()
    return this.validateAndCommit(token, attempt, { persist: options.persist ?? true })
  }

  // ───────────────────────── 기기 인증 ─────────────────────────

  /** 코드를 받아 화면에 보여 줄 때까지 기다린다. 승인 대기는 뒤에서 계속한다. */
  async startDeviceFlow(): Promise<AuthResult> {
    if (this.clientId === '') return this.fail('device_flow_unavailable')
    const attempt = this.beginAttempt()
    const abort = new AbortController()
    this.deviceAbort = abort
    this.state = 'signing_in'
    this.deviceFlow = { userCode: '', verificationUri: '', expiresAt: 0, status: 'requesting' }
    this.emit()

    let code: DeviceCode
    try {
      code = await requestDeviceCode(this.deviceDeps, abort.signal)
    } catch (error) {
      if (attempt !== this.attempt) return this.fail('cancelled')
      this.deviceAbort = null
      this.endDeviceFlow('error')
      return this.fail(
        error instanceof DeviceFlowError && error.code === 'offline' ? 'offline' : 'http_error'
      )
    }
    if (attempt !== this.attempt) return this.fail('cancelled')

    this.deviceFlow = {
      userCode: code.userCode,
      verificationUri: code.verificationUri,
      expiresAt: code.expiresAt,
      status: 'pending'
    }
    this.emit()
    void this.pollDevice(code, abort, attempt).catch(() => {
      if (attempt === this.attempt) this.endDeviceFlow('error')
    })
    return { ok: true, session: this.getSession() }
  }

  /** 진행 중이면 취소(cancelled 표시), 이미 끝났으면 표시를 지운다. */
  cancelDeviceFlow(): SessionSnapshot {
    const flow = this.deviceFlow
    if (flow && (flow.status === 'requesting' || flow.status === 'pending')) {
      this.attempt++
      this.abortDevice()
      this.endDeviceFlow('cancelled')
    } else if (flow) {
      this.deviceFlow = undefined
      this.emit()
    }
    return this.getSession()
  }

  /** 인증 주소를 안전한 외부 열기(http/https 만)로 연다. */
  async openVerificationUri(open: (url: string) => Promise<void>): Promise<{ opened: boolean }> {
    const flow = this.deviceFlow
    if (!flow || flow.status !== 'pending' || flow.verificationUri === '') return { opened: false }
    return { opened: await openExternalSafe(flow.verificationUri, open) }
  }

  // ───────────────────────── 로그아웃·저장 방법 ─────────────────────────

  /** 토큰(메모리·저장소)과 가져온 정보를 지운다. 고정·연결·설정·마지막 사용자 ID 는 남긴다. */
  logout(): SessionSnapshot {
    this.attempt++
    this.abortDevice()
    this.token = null
    this.cred = null
    this.deviceFlow = undefined
    this.storagePrompt = undefined
    this.state = 'signed_out'
    this.restoreState = 'signed_out'
    try {
      try {
        this.store.clear()
      } finally {
        // 토큰 파일 삭제가 실패해도 가져온 정보는 반드시 지운다.
        this.account.clearFetchedData()
      }
    } finally {
      this.emit()
    }
    return this.getSession()
  }

  /** 리눅스 약한 암호화 안내에서 고른 값을 기억하고, 기다리던 토큰에 적용한다. */
  chooseInsecureStorage(choice: InsecureStorageChoice): SessionSnapshot {
    if (choice !== 'save' && choice !== 'memory') return this.getSession()
    this.store.setInsecureChoice(choice)
    if (this.storagePrompt) {
      this.storagePrompt = undefined
      this.persist()
    }
    this.emit()
    return this.getSession()
  }

  dispose(): void {
    this.attempt++
    this.abortDevice()
    this.unsubscribeClient?.()
    this.unsubscribeClient = null
    this.client = null
    this.listeners.clear()
  }

  // ───────────────────────── 내부 ─────────────────────────

  private beginAttempt(): number {
    this.abortDevice()
    this.attempt++
    if (this.state !== 'signing_in') this.restoreState = this.state
    return this.attempt
  }

  private abortDevice(): void {
    this.deviceAbort?.abort()
    this.deviceAbort = null
  }

  private async pollDevice(
    code: DeviceCode,
    abort: AbortController,
    attempt: number
  ): Promise<void> {
    const outcome = await pollForToken(this.deviceDeps, code, abort.signal)
    if (attempt !== this.attempt) return
    this.deviceAbort = null
    if (outcome.kind === 'success') {
      const result = await this.validateAndCommit(outcome.token, attempt, {
        persist: true,
        kindHint: 'oauth'
      })
      if (!result.ok && attempt === this.attempt) this.endDeviceFlow('error')
      return
    }
    this.endDeviceFlow(outcome.kind === 'error' ? 'error' : outcome.kind)
  }

  /** 기기 인증을 끝난 상태로 표시하고 이전 상태로 돌아간다. */
  private endDeviceFlow(status: DeviceFlowStatus): void {
    const flow = this.deviceFlow ?? {
      userCode: '',
      verificationUri: '',
      expiresAt: 0,
      status
    }
    this.deviceFlow = { ...flow, status }
    this.state = this.restoreState
    this.emit()
  }

  private async validateAndCommit(
    token: string,
    attempt: number,
    options: { persist: boolean; kindHint?: 'oauth' }
  ): Promise<AuthResult> {
    let validated: ValidatedToken
    try {
      validated = await validateToken(token, {
        fetch: this.fetchFn,
        apiBase: this.apiBase,
        kindHint: options.kindHint
      })
    } catch (error) {
      if (attempt !== this.attempt) return this.fail('cancelled')
      this.state = this.restoreState
      this.emit()
      return this.fail(error instanceof TokenValidationError ? error.code : 'http_error')
    }
    if (attempt !== this.attempt) return this.fail('cancelled')

    try {
      this.commitLogin(token, validated, options.persist)
    } catch (error) {
      this.state = this.restoreState
      this.emit()
      throw error
    }
    return { ok: true, session: this.getSession() }
  }

  private commitLogin(token: string, validated: ValidatedToken, persist: boolean): void {
    const { user, tokenKind, scopes } = validated
    // 다른 계정이면 이전 계정의 가져온 정보·고정·연결을 먼저 지운다(설정은 남김)
    if (this.account.isDifferentAccount(user.id)) this.account.clearAccountData()
    this.account.setLastUserId(user.id)

    this.token = token
    this.cred = { tokenKind, user, scopes }
    this.storagePrompt = undefined
    if (persist) this.persist()

    this.client?.resetSession()
    this.deviceFlow = undefined
    this.state = 'signed_in'
    this.restoreState = 'signed_in'
    this.emit()
  }

  /** 현재 토큰을 저장한다. 리눅스 약한 암호화면 고를 때까지 메모리에만 두고 안내를 띄운다. */
  private persist(): void {
    if (!this.token || !this.cred) return
    let outcome: SaveOutcome
    try {
      outcome = this.store.save({ token: this.token, ...this.cred })
    } catch {
      // 저장 실패(키체인 거부 등): 이번 실행에만 메모리에 둔다
      outcome = 'memory'
    }
    if (outcome === 'needs_choice') this.storagePrompt = 'linux_insecure'
  }

  private markExpired(): void {
    if (this.state === 'signed_in') {
      this.state = 'expired'
      this.restoreState = 'expired'
      this.emit()
    } else if (this.state === 'signing_in' && this.restoreState === 'signed_in') {
      this.restoreState = 'expired'
    }
  }

  private fail(error: AuthErrorCode): AuthResult {
    return { ok: false, error, session: this.getSession() }
  }

  private emit(): void {
    if (this.listeners.size === 0) return
    const snapshot = this.getSession()
    for (const listener of [...this.listeners]) listener(snapshot)
  }
}

/**
 * 테스트 모드에서만: `GDESK_TEST_TOKEN` 으로 일반 검증 경로(GET /user, 가짜 API)를 거쳐 로그인한다.
 * 화면 자동 테스트가 로그인 화면을 건너뛰게 한다. 저장하지 않는다(실행마다 환경 변수로 다시 넣는다).
 */
export async function autoLoginForTests(
  service: AuthService,
  options: { testMode: boolean; env: NodeJS.ProcessEnv }
): Promise<AuthResult | null> {
  if (!options.testMode) return null
  const token = options.env.GDESK_TEST_TOKEN
  if (!token) return null
  return service.loginWithToken(token, { persist: false })
}
