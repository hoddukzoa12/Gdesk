import { describe, expect, it } from 'vitest'
import type { Language } from './i18n'
import { resolveLanguage, type LanguagePreference } from './language'

describe('resolveLanguage', () => {
  const cases: Array<[LanguagePreference, string | undefined, Language]> = [
    ['system', 'ko', 'ko'],
    ['system', 'ko-KR', 'ko'],
    ['system', 'KO-kr', 'ko'],
    ['system', 'en-US', 'en'],
    ['system', 'ja-JP', 'en'],
    ['system', 'de', 'en'],
    ['system', '', 'en'],
    ['system', undefined, 'en'],
    ['en', 'ko-KR', 'en'],
    ['en', 'en-US', 'en'],
    ['ko', 'en-US', 'ko'],
    ['ko', undefined, 'ko']
  ]
  it.each(cases)('%s + OS %s → %s', (pref, os, expected) => {
    expect(resolveLanguage(pref, os)).toBe(expected)
  })
})
