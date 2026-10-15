import { describe, expect, it } from 'vitest'
import { parseRefreshScope } from '@shared/domain/sync'
import { scopeForPathname } from './refreshScope'

describe('scopeForPathname', () => {
  it.each([
    ['/home', 'home'],
    ['/inbox', 'inbox'],
    ['/pulls', 'pulls'],
    ['/reviews', 'reviews'],
    ['/issues', 'issues'],
    ['/starred', 'starred'],
    ['/repositories', 'repositories'],
    ['/repos/101', 'repo:101'],
    ['/repos/101/', 'repo:101'],
    ['/repos/42/commits', 'repo:42']
  ])('%s → %s', (pathname, scope) => {
    expect(scopeForPathname(pathname)).toBe(scope)
  })

  it.each([
    '/',
    '',
    '/about',
    '/settings',
    '/repos',
    '/repos/abc',
    '/repos/0',
    '/repos/-1',
    '/toString'
  ])('그 밖의 주소 %j 는 home', (pathname) => {
    expect(scopeForPathname(pathname)).toBe('home')
  })

  it('하위 경로가 붙은 화면도 그 화면 범위', () => {
    expect(scopeForPathname('/pulls/mine')).toBe('pulls')
  })

  it('결과는 항상 메인이 받아들이는 범위', () => {
    for (const p of ['/home', '/repos/7', '/x', '/repos/99999999999999999999']) {
      expect(parseRefreshScope(scopeForPathname(p))).not.toBeNull()
    }
  })
})
