import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GITHUB_API_BASE,
  DEFAULT_GITHUB_WEB_BASE,
  githubApiBase,
  githubWebBase,
  isTestMode
} from './config'

// Vitest 에서는 __GDESK_TEST_BUILD__ 가 false 로 정의된다 = 배포 빌드와 같은 조건.
describe('githubApiBase', () => {
  it('테스트 전용 빌드가 아니면 GDESK_TEST_MODE=1 이어도 테스트 모드가 아니다', () => {
    expect(isTestMode({ GDESK_TEST_MODE: '1' })).toBe(false)
  })

  it('테스트 모드가 아니면 GDESK_TEST_API_BASE 덮어쓰기를 거부한다', () => {
    const env = { GDESK_TEST_MODE: '1', GDESK_TEST_API_BASE: 'http://localhost:9999' }
    expect(githubApiBase(env)).toBe(DEFAULT_GITHUB_API_BASE)
    expect(githubApiBase({ GDESK_TEST_API_BASE: 'http://evil.example' })).toBe(
      DEFAULT_GITHUB_API_BASE
    )
  })

  it('기본값은 api.github.com', () => {
    expect(githubApiBase({})).toBe('https://api.github.com')
  })
})

describe('githubWebBase', () => {
  it('테스트 모드가 아니면 GDESK_TEST_WEB_BASE 덮어쓰기를 거부한다', () => {
    const env = { GDESK_TEST_MODE: '1', GDESK_TEST_WEB_BASE: 'http://localhost:9999' }
    expect(githubWebBase(env)).toBe(DEFAULT_GITHUB_WEB_BASE)
    expect(githubWebBase({ GDESK_TEST_WEB_BASE: 'http://evil.example' })).toBe(
      DEFAULT_GITHUB_WEB_BASE
    )
  })

  it('기본값은 github.com', () => {
    expect(githubWebBase({})).toBe('https://github.com')
  })
})
