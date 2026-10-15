import type { RefreshScope } from '@shared/domain/sync'

const SCREEN_SCOPES: Record<string, RefreshScope> = {
  home: 'home',
  inbox: 'inbox',
  pulls: 'pulls',
  reviews: 'reviews',
  issues: 'issues',
  starred: 'starred',
  repositories: 'repositories'
}

/**
 * 지금 화면 주소 → 수동 새로고침 범위 (spec §6).
 * `/repos/<id>` 는 `repo:<id>`, 알 수 없는 주소는 `home`.
 */
export function scopeForPathname(pathname: string): RefreshScope {
  const segments = pathname.split('/').filter((s) => s !== '')
  const [first, second] = segments
  if (first === undefined) return 'home'
  if (first === 'repos') {
    if (second !== undefined && /^[1-9]\d*$/.test(second) && Number.isSafeInteger(Number(second))) {
      return `repo:${Number(second)}`
    }
    return 'home'
  }
  return Object.hasOwn(SCREEN_SCOPES, first) ? (SCREEN_SCOPES[first] ?? 'home') : 'home'
}
