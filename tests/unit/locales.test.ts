import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// spec 11-7: 사용자에게 보이는 모든 문구는 en·ko 번역을 모두 갖는다.
const LOCALES_DIR = join(__dirname, '../../src/renderer/locales')

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value).flatMap(([k, v]) => flattenKeys(v, prefix ? `${prefix}.${k}` : k))
}

function load(lng: string, ns: string): string[] {
  const json: unknown = JSON.parse(readFileSync(join(LOCALES_DIR, lng, ns), 'utf8'))
  return flattenKeys(json).sort()
}

describe('번역 파일 en·ko 동기화', () => {
  const en = readdirSync(join(LOCALES_DIR, 'en')).sort()
  const ko = readdirSync(join(LOCALES_DIR, 'ko')).sort()

  it('네임스페이스 파일 목록이 같다', () => {
    expect(ko).toEqual(en)
  })

  it.each(en)('%s 의 키 집합이 같다', (ns) => {
    expect(load('ko', ns)).toEqual(load('en', ns))
  })
})
