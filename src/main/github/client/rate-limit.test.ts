import { describe, expect, it, vi } from 'vitest'
import {
  RateLimitTracker,
  SECONDARY_DEFAULT_WAIT_MS,
  classifyRateLimit,
  parseRateLimitHeaders,
  resourceForRequest
} from './rate-limit'

const NOW = 1_700_000_000_000
const RESET_S = 1_700_000_600 // NOW + 600초

function rlHeaders(remaining: number, limit: number, resource: string, extra = {}): Headers {
  return new Headers({
    'x-ratelimit-remaining': String(remaining),
    'x-ratelimit-limit': String(limit),
    'x-ratelimit-reset': String(RESET_S),
    'x-ratelimit-resource': resource,
    'x-ratelimit-used': String(limit - remaining),
    ...extra
  })
}

describe('parseRateLimitHeaders', () => {
  it('헤더를 읽고 reset 을 ms 로 바꾼다', () => {
    expect(parseRateLimitHeaders(rlHeaders(4990, 5000, 'core'), 'core')).toEqual({
      resource: 'core',
      remaining: 4990,
      limit: 5000,
      used: 10,
      resetAt: RESET_S * 1000
    })
  })

  it('resource 헤더가 없으면 예상 자원을 쓴다', () => {
    const h = new Headers({
      'x-ratelimit-remaining': '1',
      'x-ratelimit-limit': '30',
      'x-ratelimit-reset': String(RESET_S)
    })
    expect(parseRateLimitHeaders(h, 'search')?.resource).toBe('search')
  })

  it('헤더가 없으면 null', () => {
    expect(parseRateLimitHeaders(new Headers(), 'core')).toBeNull()
  })
})

describe('resourceForRequest', () => {
  it.each([
    ['/graphql', 'graphql'],
    ['/search/issues', 'search'],
    ['/search/code', 'code_search'],
    ['/repos/a/b/issues', 'core'],
    ['/notifications', 'core']
  ])('%s → %s', (path, expected) => {
    expect(resourceForRequest(path)).toBe(expected)
  })
})

describe('RateLimitTracker', () => {
  it('자원별로 따로 추적한다', () => {
    const t = new RateLimitTracker({ now: () => NOW })
    t.record(parseRateLimitHeaders(rlHeaders(4000, 5000, 'core'), 'core')!)
    t.record(parseRateLimitHeaders(rlHeaders(4500, 5000, 'graphql'), 'graphql')!)
    t.record(parseRateLimitHeaders(rlHeaders(25, 30, 'search'), 'search')!)
    expect(t.get('core')?.remaining).toBe(4000)
    expect(t.get('graphql')?.remaining).toBe(4500)
    expect(t.get('search')?.remaining).toBe(25)
    expect(Object.keys(t.snapshot()).sort()).toEqual(['core', 'graphql', 'search'])
  })

  it('남은 양이 기본 10% 미만으로 떨어질 때 한 번 low 신호를 낸다', () => {
    const t = new RateLimitTracker({ now: () => NOW })
    const onLow = vi.fn()
    t.onLow(onLow)
    t.record({ resource: 'core', limit: 5000, remaining: 500, resetAt: RESET_S * 1000 })
    expect(onLow).not.toHaveBeenCalled()
    expect(t.isLow('core')).toBe(false)
    t.record({ resource: 'core', limit: 5000, remaining: 499, resetAt: RESET_S * 1000 })
    expect(onLow).toHaveBeenCalledTimes(1)
    expect(onLow).toHaveBeenCalledWith(
      expect.objectContaining({ resource: 'core', remaining: 499 })
    )
    t.record({ resource: 'core', limit: 5000, remaining: 450, resetAt: RESET_S * 1000 })
    expect(onLow).toHaveBeenCalledTimes(1)
    expect(t.isLow('core')).toBe(true)
    expect(t.isLow('graphql')).toBe(false)
  })

  it('기준은 조정할 수 있다', () => {
    const t = new RateLimitTracker({ now: () => NOW, lowThreshold: 0.5 })
    t.record({ resource: 'graphql', limit: 5000, remaining: 2400, resetAt: RESET_S * 1000 })
    expect(t.isLow('graphql')).toBe(true)
    t.setLowThreshold(0.25)
    expect(t.isLow('graphql')).toBe(false)
  })

  it('reset 시각이 지나면 low 가 아니다', () => {
    let now = NOW
    const t = new RateLimitTracker({ now: () => now })
    t.record({ resource: 'core', limit: 5000, remaining: 1, resetAt: RESET_S * 1000 })
    expect(t.isLow('core')).toBe(true)
    now = RESET_S * 1000
    expect(t.isLow('core')).toBe(false)
  })

  it('limit 이 0 이면 low 신호를 내지 않는다', () => {
    const t = new RateLimitTracker({ now: () => NOW })
    const onLow = vi.fn()
    t.onLow(onLow)
    t.record({ resource: 'core', limit: 0, remaining: 0, resetAt: RESET_S * 1000 })
    expect(onLow).not.toHaveBeenCalled()
  })

  it('1차 제한은 해당 자원만, 2차 제한은 전체를 막는다', () => {
    let now = NOW
    const t = new RateLimitTracker({ now: () => now })
    t.block({ kind: 'primary', resource: 'search', resetAt: NOW + 1000 })
    expect(t.activeBlockFor('search')).toMatchObject({ resetAt: NOW + 1000 })
    expect(t.activeBlockFor('core')).toBeNull()
    t.block({ kind: 'secondary', resource: 'core', resetAt: NOW + 5000 })
    expect(t.activeBlockFor('graphql')).toMatchObject({ kind: 'secondary', resetAt: NOW + 5000 })
    expect(t.nextExpiry()).toBe(NOW + 1000)
    now = NOW + 1000
    expect(t.activeBlockFor('search')).toMatchObject({ kind: 'secondary' })
    now = NOW + 5000
    expect(t.activeBlockFor('search')).toBeNull()
    expect(t.hasActiveBlock()).toBe(false)
    expect(t.nextExpiry()).toBeNull()
  })
})

describe('classifyRateLimit', () => {
  it('retry-after 가 있으면 2차 제한, 그 초만큼 기다린다', () => {
    const hit = classifyRateLimit({
      status: 403,
      headers: rlHeaders(100, 5000, 'core', { 'retry-after': '30' }),
      message: 'You have exceeded a secondary rate limit.',
      resource: 'core',
      now: NOW
    })
    expect(hit).toEqual({ kind: 'secondary', resource: 'core', resetAt: NOW + 30_000 })
  })

  it('remaining 0 이면 1차 제한, reset 까지 기다린다', () => {
    const hit = classifyRateLimit({
      status: 403,
      headers: rlHeaders(0, 5000, 'core'),
      message: 'API rate limit exceeded for user ID 1.',
      resource: 'core',
      now: NOW
    })
    expect(hit).toEqual({ kind: 'primary', resource: 'core', resetAt: RESET_S * 1000 })
  })

  it('429 도 같다', () => {
    const hit = classifyRateLimit({
      status: 429,
      headers: rlHeaders(0, 30, 'search'),
      message: '',
      resource: 'search',
      now: NOW
    })
    expect(hit).toMatchObject({ kind: 'primary', resource: 'search' })
  })

  it('2차 제한 문구만 있으면 기본 대기', () => {
    const hit = classifyRateLimit({
      status: 403,
      headers: rlHeaders(100, 5000, 'core'),
      message: 'You have exceeded a secondary rate limit. Please wait a few minutes.',
      resource: 'core',
      now: NOW
    })
    expect(hit).toEqual({
      kind: 'secondary',
      resource: 'core',
      resetAt: NOW + SECONDARY_DEFAULT_WAIT_MS
    })
  })

  it('지난 reset 은 지금으로 맞춘다 (시계 차이)', () => {
    const hit = classifyRateLimit({
      status: 403,
      headers: rlHeaders(0, 5000, 'core'),
      message: '',
      resource: 'core',
      now: RESET_S * 1000 + 5000
    })
    expect(hit?.resetAt).toBe(RESET_S * 1000 + 5000)
  })

  it('알 수 없는 403 과 다른 상태는 null', () => {
    const base = { headers: rlHeaders(100, 5000, 'core'), resource: 'core', now: NOW }
    expect(classifyRateLimit({ ...base, status: 403, message: 'Forbidden' })).toBeNull()
    expect(classifyRateLimit({ ...base, status: 404, message: 'Not Found' })).toBeNull()
    expect(
      classifyRateLimit({
        ...base,
        headers: rlHeaders(0, 5000, 'core'),
        status: 404,
        message: 'Not Found'
      })
    ).toBeNull()
  })
})
