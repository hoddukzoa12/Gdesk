export const THEME_PREFERENCES = ['system', 'dark', 'light'] as const
/** 사용자가 고르는 테마 값. 기본은 `system`. */
export type ThemePreference = (typeof THEME_PREFERENCES)[number]
/** 실제로 적용되는 테마. */
export type ResolvedTheme = 'dark' | 'light'

/** 테마 설정과 OS 다크 모드 여부로 실제 테마를 정한다. */
export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === 'dark' || pref === 'light') return pref
  return systemPrefersDark ? 'dark' : 'light'
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

function mediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(DARK_QUERY)
}

/** useSyncExternalStore 용: OS 다크 모드 변경 구독. */
export function subscribeSystemTheme(onChange: () => void): () => void {
  const mql = mediaQuery()
  if (!mql) return () => {}
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

/** OS 가 다크 모드인지. 알 수 없으면(matchMedia 없음) 다크로 본다. */
export function getSystemPrefersDark(): boolean {
  return mediaQuery()?.matches ?? true
}
