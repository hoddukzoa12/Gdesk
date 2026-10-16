import type { SecretStorageBackend } from './token-store'

/** 단위 테스트 전용 도우미. 배포 코드에서 import 하지 않는다. */

export interface RecordedRequest {
  url: URL
  method: string
  headers: Headers
  body: string
}

export type Route = (req: RecordedRequest) => Response | Promise<Response>

export interface FakeFetch {
  fetch: typeof fetch
  calls: RecordedRequest[]
}

export function createFakeFetch(route: Route): FakeFetch {
  const calls: RecordedRequest[] = []
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const body = init?.body === undefined || init.body === null ? '' : String(init.body)
    const req: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body
    }
    calls.push(req)
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    return route(req)
  }
  return { fetch: fn as typeof fetch, calls }
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

export interface FakeUser {
  id: number
  login: string
  name?: string | null
  /** 공개 이메일. 주지 않으면 응답에서 뺀다(email 필드 없음) */
  email?: string | null
}

/** GET /user 응답. scopes 가 null 이면 X-OAuth-Scopes 헤더를 빼서 세분화 토큰처럼 보이게 한다. */
export function userResponse(user: FakeUser, scopes: string | null): Response {
  const headers: Record<string, string> = {}
  if (scopes !== null) headers['X-OAuth-Scopes'] = scopes
  return jsonResponse(
    {
      id: user.id,
      login: user.login,
      name: user.name ?? null,
      avatar_url: `https://avatars.example/u/${user.id}`,
      ...(user.email === undefined ? {} : { email: user.email })
    },
    { status: 200, headers }
  )
}

/** 되돌릴 수 있지만 평문이 그대로 보이지 않는 가짜 암호화 */
export function fakeSecretBackend(
  overrides: Partial<SecretStorageBackend> = {}
): SecretStorageBackend {
  return {
    platform: 'darwin',
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'unknown',
    encryptString: (plain) =>
      Buffer.from(Buffer.from(plain, 'utf8').toString('base64'), 'utf8').reverse(),
    decryptString: (buf) =>
      Buffer.from(Buffer.from(buf).reverse().toString('utf8'), 'base64').toString('utf8'),
    ...overrides
  }
}
