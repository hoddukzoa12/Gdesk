/**
 * GitHub OAuth 기기 인증(device flow). 공개 client ID 만 쓰고 비밀 키(client secret)는 쓰지 않는다.
 * https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 *
 * 순수 로직이다. fetch·시계·대기는 주입받는다. 토큰은 돌려주기만 하고 기록하지 않는다.
 */

export const DEVICE_FLOW_SCOPE = 'repo read:org notifications'
export const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
/** slow_down 을 받으면 늘릴 간격(ms) */
export const SLOW_DOWN_STEP_MS = 5000
const DEFAULT_INTERVAL_MS = 5000

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>

export interface DeviceFlowDeps {
  fetch: typeof fetch
  /** GitHub 웹 주소 (githubWebBase()) */
  webBase: string
  clientId: string
  now: () => number
  sleep: Sleep
}

export interface DeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  /** ms, epoch */
  expiresAt: number
  intervalMs: number
}

export type DevicePollOutcome =
  | { kind: 'success'; token: string }
  | { kind: 'expired' }
  | { kind: 'denied' }
  | { kind: 'cancelled' }
  | { kind: 'error'; reason: string }

export type DeviceFlowErrorCode = 'offline' | 'http_error' | 'cancelled'

/** 코드 요청 실패. 문구에 응답 본문을 싣지 않는다(오류 코드 이름만). */
export class DeviceFlowError extends Error {
  readonly code: DeviceFlowErrorCode
  constructor(code: DeviceFlowErrorCode, detail?: string) {
    super(detail ? `Device flow failed (${code}): ${detail}` : `Device flow failed (${code})`)
    this.name = 'DeviceFlowError'
    this.code = code
  }
}

/** 기본 대기: 취소되면 바로 깬다. */
export const defaultSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 오류 코드처럼 생긴 짧은 문자열만 남긴다(응답 원문을 그대로 싣지 않기 위해). */
function safeReason(value: unknown): string {
  return typeof value === 'string' && /^[a-z_]{1,64}$/.test(value) ? value : 'unexpected_response'
}

function postForm(
  deps: DeviceFlowDeps,
  path: string,
  params: Record<string, string>,
  signal: AbortSignal
): Promise<Response> {
  return deps.fetch(`${deps.webBase}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(params).toString(),
    signal
  })
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

/** 1단계: 사용자 코드와 인증 주소를 받는다. */
export async function requestDeviceCode(
  deps: DeviceFlowDeps,
  signal: AbortSignal
): Promise<DeviceCode> {
  let res: Response
  try {
    res = await postForm(
      deps,
      '/login/device/code',
      { client_id: deps.clientId, scope: DEVICE_FLOW_SCOPE },
      signal
    )
  } catch {
    if (signal.aborted) throw new DeviceFlowError('cancelled')
    throw new DeviceFlowError('offline')
  }
  const body = await readJson(res)
  if (!res.ok || !isRecord(body) || 'error' in body) {
    throw new DeviceFlowError('http_error', isRecord(body) ? safeReason(body.error) : undefined)
  }
  const { device_code, user_code, verification_uri, expires_in, interval } = body
  if (
    typeof device_code !== 'string' ||
    typeof user_code !== 'string' ||
    typeof verification_uri !== 'string' ||
    typeof expires_in !== 'number'
  ) {
    throw new DeviceFlowError('http_error', 'unexpected_response')
  }
  return {
    deviceCode: device_code,
    userCode: user_code,
    verificationUri: verification_uri,
    expiresAt: deps.now() + expires_in * 1000,
    intervalMs: typeof interval === 'number' && interval > 0 ? interval * 1000 : DEFAULT_INTERVAL_MS
  }
}

/**
 * 2단계: 사용자가 승인할 때까지 간격대로 묻는다.
 * authorization_pending → 계속, slow_down → 간격 +5초, expired_token → expired,
 * access_denied → denied, 취소 → cancelled. 잠깐의 네트워크 실패는 만료 전까지 다시 묻는다.
 */
export async function pollForToken(
  deps: DeviceFlowDeps,
  code: DeviceCode,
  signal: AbortSignal
): Promise<DevicePollOutcome> {
  let intervalMs = code.intervalMs
  for (;;) {
    await deps.sleep(intervalMs, signal)
    if (signal.aborted) return { kind: 'cancelled' }
    if (deps.now() >= code.expiresAt) return { kind: 'expired' }

    let res: Response
    try {
      res = await postForm(
        deps,
        '/login/oauth/access_token',
        { client_id: deps.clientId, device_code: code.deviceCode, grant_type: DEVICE_GRANT_TYPE },
        signal
      )
    } catch {
      if (signal.aborted) return { kind: 'cancelled' }
      continue
    }
    const body = await readJson(res)
    if (signal.aborted) return { kind: 'cancelled' }
    if (!isRecord(body)) return { kind: 'error', reason: `http_${res.status}` }

    if (typeof body.access_token === 'string' && body.access_token !== '') {
      return { kind: 'success', token: body.access_token }
    }
    switch (body.error) {
      case 'authorization_pending':
        continue
      case 'slow_down': {
        intervalMs += SLOW_DOWN_STEP_MS
        // GitHub 가 새 간격을 알려 주면 더 긴 쪽을 따른다
        if (typeof body.interval === 'number' && body.interval * 1000 > intervalMs) {
          intervalMs = body.interval * 1000
        }
        continue
      }
      case 'expired_token':
        return { kind: 'expired' }
      case 'access_denied':
        return { kind: 'denied' }
      default:
        return { kind: 'error', reason: safeReason(body.error) }
    }
  }
}
