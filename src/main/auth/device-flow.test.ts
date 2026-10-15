import { describe, expect, it } from 'vitest'
import {
  DEVICE_FLOW_SCOPE,
  DEVICE_GRANT_TYPE,
  DeviceFlowError,
  pollForToken,
  requestDeviceCode,
  type DeviceCode,
  type DeviceFlowDeps
} from './device-flow'
import { createFakeFetch, jsonResponse, type Route } from './test-helpers'

const WEB = 'https://github.example'
const CLIENT_ID = 'Iv1.public-client-id'

function makeDeps(route: Route, start = 1_000_000) {
  let clock = start
  const sleeps: number[] = []
  const fake = createFakeFetch(route)
  const deps: DeviceFlowDeps = {
    fetch: fake.fetch,
    webBase: WEB,
    clientId: CLIENT_ID,
    now: () => clock,
    sleep: async (ms, signal) => {
      sleeps.push(ms)
      clock += ms
      if (signal.aborted) return
    }
  }
  return { deps, sleeps, calls: fake.calls, advance: (ms: number) => (clock += ms) }
}

function code(overrides: Partial<DeviceCode> = {}): DeviceCode {
  return {
    deviceCode: 'dev-code',
    userCode: 'ABCD-1234',
    verificationUri: 'https://github.com/login/device',
    expiresAt: 1_000_000 + 900_000,
    intervalMs: 5000,
    ...overrides
  }
}

/** 차례대로 응답하는 토큰 교환 라우트 */
function sequence(bodies: unknown[]): Route {
  let i = 0
  return () => {
    const body = bodies[Math.min(i, bodies.length - 1)]
    i++
    return jsonResponse(body)
  }
}

describe('requestDeviceCode', () => {
  it('client_id 와 권한만 보낸다(비밀 키 없음). Accept 는 JSON', async () => {
    const { deps, calls } = makeDeps(() =>
      jsonResponse({
        device_code: 'dev',
        user_code: 'WXYZ-0000',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5
      })
    )
    const result = await requestDeviceCode(deps, new AbortController().signal)

    expect(calls).toHaveLength(1)
    const req = calls[0]!
    expect(req.method).toBe('POST')
    expect(req.url.toString()).toBe(`${WEB}/login/device/code`)
    expect(req.headers.get('accept')).toBe('application/json')
    const body = new URLSearchParams(req.body)
    expect(body.get('client_id')).toBe(CLIENT_ID)
    expect(body.get('scope')).toBe(DEVICE_FLOW_SCOPE)
    expect(DEVICE_FLOW_SCOPE).toBe('repo read:org notifications')
    expect(req.body).not.toMatch(/secret/i)

    expect(result).toEqual({
      deviceCode: 'dev',
      userCode: 'WXYZ-0000',
      verificationUri: 'https://github.com/login/device',
      expiresAt: 1_000_000 + 900_000,
      intervalMs: 5000
    })
  })

  it('오류 응답이면 DeviceFlowError', async () => {
    const { deps } = makeDeps(() =>
      jsonResponse({ error: 'device_flow_disabled' }, { status: 400 })
    )
    await expect(requestDeviceCode(deps, new AbortController().signal)).rejects.toBeInstanceOf(
      DeviceFlowError
    )
  })

  it('네트워크 실패는 offline 으로 구분한다', async () => {
    const { deps } = makeDeps(() => {
      throw new TypeError('fetch failed')
    })
    await expect(requestDeviceCode(deps, new AbortController().signal)).rejects.toMatchObject({
      code: 'offline'
    })
  })
})

describe('pollForToken', () => {
  it('authorization_pending 이면 간격대로 기다렸다가 성공하면 토큰을 돌려준다', async () => {
    const { deps, sleeps, calls } = makeDeps(
      sequence([
        { error: 'authorization_pending' },
        { error: 'authorization_pending' },
        { access_token: 'gho_device_token_value', token_type: 'bearer', scope: 'repo' }
      ])
    )
    const outcome = await pollForToken(deps, code(), new AbortController().signal)

    expect(outcome).toEqual({ kind: 'success', token: 'gho_device_token_value' })
    expect(sleeps).toEqual([5000, 5000, 5000])
    expect(calls).toHaveLength(3)
    const req = calls[0]!
    expect(req.url.toString()).toBe(`${WEB}/login/oauth/access_token`)
    expect(req.headers.get('accept')).toBe('application/json')
    const body = new URLSearchParams(req.body)
    expect(body.get('client_id')).toBe(CLIENT_ID)
    expect(body.get('device_code')).toBe('dev-code')
    expect(body.get('grant_type')).toBe(DEVICE_GRANT_TYPE)
    expect(DEVICE_GRANT_TYPE).toBe('urn:ietf:params:oauth:grant-type:device_code')
    expect(req.body).not.toMatch(/secret/i)
  })

  it('slow_down 이면 간격을 5초 늘린다', async () => {
    const { deps, sleeps } = makeDeps(
      sequence([
        { error: 'slow_down' },
        { error: 'authorization_pending' },
        { error: 'slow_down' },
        { access_token: 'gho_x' }
      ])
    )
    const outcome = await pollForToken(deps, code(), new AbortController().signal)
    expect(outcome.kind).toBe('success')
    expect(sleeps).toEqual([5000, 10_000, 10_000, 15_000])
  })

  it('expired_token 이면 expired', async () => {
    const { deps } = makeDeps(
      sequence([{ error: 'authorization_pending' }, { error: 'expired_token' }])
    )
    expect(await pollForToken(deps, code(), new AbortController().signal)).toEqual({
      kind: 'expired'
    })
  })

  it('만료 시각이 지나면 서버 응답 없이도 expired', async () => {
    const { deps, calls } = makeDeps(sequence([{ error: 'authorization_pending' }]))
    const outcome = await pollForToken(
      deps,
      code({ expiresAt: 1_000_000 + 12_000 }),
      new AbortController().signal
    )
    expect(outcome).toEqual({ kind: 'expired' })
    expect(calls.length).toBe(2)
  })

  it('access_denied 이면 denied', async () => {
    const { deps } = makeDeps(sequence([{ error: 'access_denied' }]))
    expect(await pollForToken(deps, code(), new AbortController().signal)).toEqual({
      kind: 'denied'
    })
  })

  it('취소하면 cancelled 이고 더 묻지 않는다', async () => {
    const controller = new AbortController()
    const { deps, calls } = makeDeps(() => {
      controller.abort()
      return jsonResponse({ error: 'authorization_pending' })
    })
    expect(await pollForToken(deps, code(), controller.signal)).toEqual({ kind: 'cancelled' })
    expect(calls).toHaveLength(1)
  })

  it('알 수 없는 오류는 error', async () => {
    const { deps } = makeDeps(sequence([{ error: 'incorrect_device_code' }]))
    expect(await pollForToken(deps, code(), new AbortController().signal)).toEqual({
      kind: 'error',
      reason: 'incorrect_device_code'
    })
  })

  it('네트워크가 잠깐 끊겨도 계속 묻는다', async () => {
    let n = 0
    const { deps } = makeDeps(() => {
      n++
      if (n === 1) throw new TypeError('fetch failed')
      return jsonResponse({ access_token: 'gho_after_blip' })
    })
    expect(await pollForToken(deps, code(), new AbortController().signal)).toEqual({
      kind: 'success',
      token: 'gho_after_blip'
    })
  })
})
