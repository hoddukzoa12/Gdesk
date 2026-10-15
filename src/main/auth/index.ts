import type { TokenProvider } from '../github/client'
import { GITHUB_CLIENT_ID, githubApiBase, githubWebBase, isTestMode } from '../config'
import { getDb } from '../db/db'
import {
  AuthService,
  accountOpsFromDb,
  autoLoginForTests,
  type AccountOps,
  type CredentialStore,
  type SessionClient
} from './auth.service'
import type { Sleep } from './device-flow'
import type { SessionSnapshot } from '@shared/domain/session'

/**
 * 로그인·세션 공개 API (메인 프로세스 전용). Electron 을 import 하지 않는다.
 * 실제 앱의 저장소는 `./electron` 의 createElectronTokenStore() 로 만든다.
 */

export { AuthService, accountOpsFromDb, autoLoginForTests } from './auth.service'
export type { AccountOps, CredentialStore, SessionClient } from './auth.service'
export { TokenStore } from './token-store'
export type { SecretStorageBackend, StoredCredential, SaveOutcome } from './token-store'

export interface InitAuthOptions {
  store: CredentialStore
  /** 기본: getDb() 위의 계정 작업 */
  account?: AccountOps
  /** 기본: 빌드 시 주입된 GITHUB_CLIENT_ID */
  clientId?: string
  /** 기본: githubApiBase() */
  apiBase?: string
  /** 기본: githubWebBase() */
  webBase?: string
  fetch?: typeof fetch
  now?: () => number
  sleep?: Sleep
}

let service: AuthService | null = null
const changeListeners = new Set<(session: SessionSnapshot) => void>()

/** setupDatabase 뒤, configureGitHubClient 앞에서 한 번 부른다. 저장된 토큰을 읽는다. */
export function initAuth(options: InitAuthOptions): AuthService {
  service?.dispose()
  const next = new AuthService({
    store: options.store,
    account: options.account ?? accountOpsFromDb(getDb),
    clientId: options.clientId ?? GITHUB_CLIENT_ID,
    apiBase: options.apiBase ?? githubApiBase(),
    webBase: options.webBase ?? githubWebBase(),
    fetch: options.fetch,
    now: options.now,
    sleep: options.sleep
  })
  next.onChange((session) => {
    for (const listener of [...changeListeners]) listener(session)
  })
  next.init()
  service = next
  return next
}

export function getAuthService(): AuthService {
  if (!service) throw new Error('Auth is not initialized; call initAuth()')
  return service
}

/** 메인 프로세스 전용: 현재 토큰. GitHub 클라이언트와 클론 서비스가 쓴다. 화면으로 보내지 않는다. */
export function getToken(): string | null {
  return service?.getToken() ?? null
}

/** configureGitHubClient({ tokenProvider }) 에 넘긴다. */
export const tokenProvider: TokenProvider = () => getToken()

/** 세션 변경 구독. initAuth 전에 등록해도 된다(IPC 등록 순서와 무관). */
export function onAuthChanged(listener: (session: SessionSnapshot) => void): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}

export interface StartAuthOptions {
  /** 기본: isTestMode(env) */
  testMode?: boolean
  env?: NodeJS.ProcessEnv
}

/**
 * configureGitHubClient 뒤에 부른다.
 * 1) 클라이언트 상태 구독(401 → expired)
 * 2) 테스트 모드면 GDESK_TEST_TOKEN 으로 자동 로그인(끝날 때까지 기다린다)
 * 3) 아니면 저장된 토큰을 뒤에서 다시 확인한다(기다리지 않는다)
 */
export async function startAuth(
  client: SessionClient,
  options: StartAuthOptions = {}
): Promise<void> {
  const auth = getAuthService()
  const env = options.env ?? process.env
  auth.attachClient(client)
  const auto = await autoLoginForTests(auth, {
    testMode: options.testMode ?? isTestMode(env),
    env
  })
  if (auto === null) void auth.revalidate()
}

/** 테스트 전용 */
export function resetAuthForTests(): void {
  service?.dispose()
  service = null
  changeListeners.clear()
}
