import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GITHUB_API_BASE } from '../../config'
import * as publicApi from './index'
import { GitHubClient, createGitHubClient } from './index'
import { createGitHubClientForTests } from './testing'

// 불변 조건: API 주소는 테스트 모드에서만 바꿀 수 있다.
describe('API 주소 덮어쓰기', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    publicApi.resetGitHubClientForTests()
  })

  const tokenProvider = () => 't'
  const evil = { tokenProvider, baseUrl: 'https://evil.example' }

  it('공개 생성자·팩토리·싱글턴은 baseUrl 을 무시하고 githubApiBase() 를 쓴다', () => {
    expect(new GitHubClient(evil as never).baseUrl).toBe(DEFAULT_GITHUB_API_BASE)
    expect(createGitHubClient(evil as never).baseUrl).toBe(DEFAULT_GITHUB_API_BASE)
    expect(publicApi.configureGitHubClient(evil as never).baseUrl).toBe(DEFAULT_GITHUB_API_BASE)
  })

  it('index 는 테스트용 통로를 내보내지 않는다', () => {
    expect(Object.keys(publicApi)).not.toContain('createGitHubClientForTests')
    expect(Object.keys(publicApi).some((k) => /test_base|TEST_BASE/i.test(k))).toBe(false)
  })

  it('테스트 통로는 테스트 실행에서만 동작한다', () => {
    expect(createGitHubClientForTests({ tokenProvider, baseUrl: 'http://x.test/' }).baseUrl).toBe(
      'http://x.test'
    )
    vi.stubEnv('MODE', 'production')
    expect(() =>
      createGitHubClientForTests({ tokenProvider, baseUrl: 'https://evil.example' })
    ).toThrow(/test/i)
  })
})
