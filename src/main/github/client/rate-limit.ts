/**
 * GitHub 요청 한도 추적 (spec §6).
 * - 자원(core·graphql·search…)마다 남은 양·한도·reset 을 따로 기록한다.
 * - 남은 양이 기준(기본 10%) 미만으로 떨어지면 low 신호를 한 번 낸다.
 * - 한도 초과 응답을 받으면 GitHub 가 알려 준 시각까지 막아 둔다.
 */

/** 기본 low 기준: 한도의 10% 미만 */
export const DEFAULT_LOW_RATE_LIMIT_RATIO = 0.1
/** 2차 제한인데 retry-after 도 reset 도 없을 때 기다리는 시간 (GitHub 안내: 최소 1분) */
export const SECONDARY_DEFAULT_WAIT_MS = 60_000
/** 1차 제한인데 reset 헤더가 없을 때 기다리는 시간 */
export const PRIMARY_FALLBACK_WAIT_MS = 60_000

export type RateLimitKind = 'primary' | 'secondary'

export interface RateLimitInfo {
  /** `x-ratelimit-resource` 값. core · graphql · search · code_search … */
  resource: string
  limit: number
  remaining: number
  used?: number
  /** 한도가 다시 차는 시각 (ms, epoch) */
  resetAt: number
}

export interface RateLimitHit {
  kind: RateLimitKind
  /** 1차 제한이면 막힌 자원. 2차 제한은 모든 자원을 막는다. */
  resource: string
  /** 이 시각(ms, epoch)까지 기다린다 */
  resetAt: number
}

function intHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name)
  if (raw === null || raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

export function parseRateLimitHeaders(
  headers: Headers,
  fallbackResource: string
): RateLimitInfo | null {
  const remaining = intHeader(headers, 'x-ratelimit-remaining')
  const limit = intHeader(headers, 'x-ratelimit-limit')
  const reset = intHeader(headers, 'x-ratelimit-reset')
  if (remaining === undefined || limit === undefined || reset === undefined) return null
  const info: RateLimitInfo = {
    resource: headers.get('x-ratelimit-resource')?.trim() || fallbackResource,
    remaining,
    limit,
    resetAt: reset * 1000
  }
  const used = intHeader(headers, 'x-ratelimit-used')
  if (used !== undefined) info.used = used
  return info
}

/** 요청 전에 어느 자원을 쓸지 짐작한다. 응답의 `x-ratelimit-resource` 가 오면 그것을 믿는다. */
export function resourceForRequest(path: string): string {
  const pathname = path.split('?')[0] ?? ''
  if (/(^|\/)graphql$/.test(pathname)) return 'graphql'
  if (/(^|\/)search\/code(\/|$)/.test(pathname)) return 'code_search'
  if (/(^|\/)search\//.test(pathname)) return 'search'
  return 'core'
}

const SECONDARY_MESSAGE = /secondary rate limit/i

/**
 * 403/429 응답이 요청 한도 때문인지 판단한다 (GitHub 안내 순서).
 * 1) retry-after 가 있으면 2차 제한, 그 초만큼
 * 2) remaining 이 0 이면 1차 제한, reset 까지
 * 3) 2차 제한 문구만 있으면 기본 60초
 * 그 밖의 403 은 한도가 아니다(null).
 */
export function classifyRateLimit(input: {
  status: number
  headers: Headers
  message: string
  resource: string
  now: number
}): RateLimitHit | null {
  const { status, headers, message, now } = input
  if (status !== 403 && status !== 429) return null
  const resource = headers.get('x-ratelimit-resource')?.trim() || input.resource

  const retryAfter = intHeader(headers, 'retry-after')
  if (retryAfter !== undefined) {
    return { kind: 'secondary', resource, resetAt: now + Math.max(0, retryAfter) * 1000 }
  }
  const remaining = intHeader(headers, 'x-ratelimit-remaining')
  if (remaining === 0) {
    return {
      kind: SECONDARY_MESSAGE.test(message) ? 'secondary' : 'primary',
      resource,
      resetAt: resetFrom(headers, now)
    }
  }
  if (SECONDARY_MESSAGE.test(message)) {
    return { kind: 'secondary', resource, resetAt: now + SECONDARY_DEFAULT_WAIT_MS }
  }
  return null
}

/** `x-ratelimit-reset`(초) → ms. 지난 시각이면(시계 차이) 지금으로 맞춘다. */
export function resetFrom(headers: Headers, now: number): number {
  const reset = intHeader(headers, 'x-ratelimit-reset')
  if (reset === undefined) return now + PRIMARY_FALLBACK_WAIT_MS
  return Math.max(now, reset * 1000)
}

const ALL_RESOURCES = '*'

export class RateLimitTracker {
  private readonly now: () => number
  private ratio: number
  private readonly info = new Map<string, RateLimitInfo>()
  private readonly lowState = new Map<string, boolean>()
  private readonly blocks = new Map<string, RateLimitHit>()
  private readonly lowListeners = new Set<(info: RateLimitInfo) => void>()

  constructor(options: { now: () => number; lowThreshold?: number }) {
    this.now = options.now
    this.ratio = normalizeRatio(options.lowThreshold)
  }

  record(info: RateLimitInfo): void {
    this.info.set(info.resource, { ...info })
    const low = this.computeLow(info)
    const wasLow = this.lowState.get(info.resource) ?? false
    this.lowState.set(info.resource, low)
    if (low && !wasLow) {
      for (const listener of [...this.lowListeners]) {
        try {
          listener({ ...info })
        } catch {
          // 구독자 오류가 요청 처리를 깨뜨리지 않게 한다
        }
      }
    }
  }

  get(resource: string): RateLimitInfo | undefined {
    const info = this.info.get(resource)
    return info ? { ...info } : undefined
  }

  snapshot(): Record<string, RateLimitInfo> {
    const out: Record<string, RateLimitInfo> = {}
    for (const [key, value] of this.info) out[key] = { ...value }
    return out
  }

  /** 남은 양이 기준 미만인가. reset 시각이 지났으면 아니다. */
  isLow(resource: string): boolean {
    const info = this.info.get(resource)
    if (!info || this.now() >= info.resetAt) return false
    return this.computeLow(info)
  }

  setLowThreshold(ratio: number): void {
    this.ratio = normalizeRatio(ratio)
  }

  get lowThreshold(): number {
    return this.ratio
  }

  onLow(listener: (info: RateLimitInfo) => void): () => void {
    this.lowListeners.add(listener)
    return () => {
      this.lowListeners.delete(listener)
    }
  }

  /** 막아 둔다. 같은 범위에 이미 더 늦은 막힘이 있으면 그것을 유지한다. */
  block(hit: RateLimitHit): void {
    const key = hit.kind === 'secondary' ? ALL_RESOURCES : hit.resource
    const existing = this.blocks.get(key)
    if (!existing || existing.resetAt < hit.resetAt) this.blocks.set(key, { ...hit })
  }

  /** 이 자원의 요청을 지금 막는 것이 있으면 가장 늦게 풀리는 것 */
  activeBlockFor(resource: string): RateLimitHit | null {
    this.prune()
    const own = this.blocks.get(resource)
    const all = this.blocks.get(ALL_RESOURCES)
    if (own && all) return own.resetAt >= all.resetAt ? { ...own } : { ...all }
    const hit = own ?? all
    return hit ? { ...hit } : null
  }

  hasActiveBlock(): boolean {
    this.prune()
    return this.blocks.size > 0
  }

  /** 막힘이 하나라도 남아 있는 마지막 시각 */
  blockedUntil(): number | null {
    this.prune()
    let latest: number | null = null
    for (const hit of this.blocks.values()) latest = Math.max(latest ?? 0, hit.resetAt)
    return latest
  }

  /** 가장 먼저 풀리는 막힘의 시각 (회복 타이머용) */
  nextExpiry(): number | null {
    this.prune()
    let earliest: number | null = null
    for (const hit of this.blocks.values()) {
      earliest = earliest === null ? hit.resetAt : Math.min(earliest, hit.resetAt)
    }
    return earliest
  }

  private prune(): void {
    const now = this.now()
    for (const [key, hit] of this.blocks) if (now >= hit.resetAt) this.blocks.delete(key)
  }

  private computeLow(info: RateLimitInfo): boolean {
    return info.limit > 0 && info.remaining < info.limit * this.ratio
  }
}

function normalizeRatio(ratio: number | undefined): number {
  if (ratio === undefined || !Number.isFinite(ratio)) return DEFAULT_LOW_RATE_LIMIT_RATIO
  return Math.min(1, Math.max(0, ratio))
}
