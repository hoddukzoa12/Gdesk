import { afterEach, describe, expect, it } from 'vitest'
import { configureGitHubClient, getGitHubClient, resetGitHubClientForTests } from './index'

describe('GitHub 클라이언트 싱글턴', () => {
  afterEach(() => resetGitHubClientForTests())

  it('설정 전에는 가져올 수 없다', () => {
    expect(() => getGitHubClient()).toThrow(/not configured/)
  })

  it('설정하면 githubApiBase() 주소를 쓴다', () => {
    const client = configureGitHubClient({ tokenProvider: () => 't' })
    expect(getGitHubClient()).toBe(client)
    expect(client.baseUrl).toBe('https://api.github.com')
    expect(client.getStatus()).toBe('online')
  })
})
