import { describe, expect, it } from 'vitest'
import { isBotActor, toActor } from './actor'

describe('isBotActor', () => {
  it.each([
    [{ __typename: 'Bot', login: 'dependabot' }, true],
    [{ __typename: 'User', login: 'renovate[bot]' }, true],
    [{ __typename: 'User', login: 'octocat' }, false],
    [{ __typename: 'Organization', login: 'acme' }, false],
    [{ login: 'github-actions[bot]' }, true],
    [null, false]
  ] as const)('%o → %s', (raw, expected) => {
    expect(isBotActor(raw)).toBe(expected)
  })
})

describe('toActor', () => {
  it('지워진 계정(null)은 ghost', () => {
    expect(toActor(null)).toEqual({ login: 'ghost', avatarUrl: null, isBot: false })
  })
  it('필드를 옮긴다', () => {
    expect(toActor({ __typename: 'Bot', login: 'dependabot', avatarUrl: 'https://a/x' })).toEqual({
      login: 'dependabot',
      avatarUrl: 'https://a/x',
      isBot: true
    })
  })
})
