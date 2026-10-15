import { describe, expect, it } from 'vitest'
import { resolveTheme, type ResolvedTheme, type ThemePreference } from './theme'

describe('resolveTheme', () => {
  const cases: Array<[ThemePreference, boolean, ResolvedTheme]> = [
    ['system', true, 'dark'],
    ['system', false, 'light'],
    ['dark', true, 'dark'],
    ['dark', false, 'dark'],
    ['light', true, 'light'],
    ['light', false, 'light']
  ]
  it.each(cases)('%s + OS 다크=%s → %s', (pref, systemDark, expected) => {
    expect(resolveTheme(pref, systemDark)).toBe(expected)
  })
})
