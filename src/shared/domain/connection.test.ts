import { describe, expect, it } from 'vitest'
import { resolveConnectionStatus } from './connection'

describe('resolveConnectionStatus', () => {
  it.each([
    [{}, 'online'],
    [{ rateLimited: true }, 'rate_limited'],
    [{ offline: true }, 'offline'],
    [{ sessionExpired: true }, 'session_expired'],
    [{ offline: true, rateLimited: true }, 'offline'],
    [{ sessionExpired: true, offline: true }, 'session_expired'],
    [{ sessionExpired: true, rateLimited: true }, 'session_expired'],
    [{ sessionExpired: true, offline: true, rateLimited: true }, 'session_expired']
  ] as const)('%o → %s', (flags, expected) => {
    expect(resolveConnectionStatus(flags)).toBe(expected)
  })
})
