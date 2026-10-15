import { describe, expect, it } from 'vitest'
import type { CiStatus } from '@shared/domain/ci'
import type { LanguageShare } from '@shared/domain/repo'
import {
  OTHER_LANGUAGE_COLOR,
  ciBars,
  ciSummary,
  formatPercent,
  labelColor,
  languageBars,
  languageColor,
  repoLink
} from './repo-detail'

const commits = (...s: CiStatus[]) => s.map((ciStatus) => ({ ciStatus }))

describe('ciSummary: 최신 커밋(첫 항목)의 상태', () => {
  it.each<[CiStatus[], CiStatus]>([
    [['passing', 'failing', 'failing'], 'passing'],
    [['failing', 'passing'], 'failing'],
    [['pending', 'passing'], 'pending'],
    [['none', 'passing'], 'none'],
    [[], 'none']
  ])('%j → %s', (list, expected) => {
    expect(ciSummary(commits(...list))).toBe(expected)
  })
})

describe('ciBars', () => {
  it('최신 → 과거 목록을 과거 → 최신으로 뒤집고 7개까지만', () => {
    const list = commits(
      'passing',
      'failing',
      'pending',
      'none',
      'failing',
      'pending',
      'passing',
      'failing'
    )
    expect(ciBars(list)).toEqual([
      'passing',
      'pending',
      'failing',
      'none',
      'pending',
      'failing',
      'passing'
    ])
    expect(ciBars([])).toEqual([])
  })
})

const lang = (name: string, bytes: number, color: string | null = null): LanguageShare => ({
  name,
  bytes,
  color,
  ratio: 0
})

describe('languageBars', () => {
  it('비율과 퍼센트 문구, 데이터 색을 그대로 쓴다', () => {
    const items = languageBars([
      lang('CSS', 24_310, '#663399'),
      lang('TypeScript', 182_340, '#3178c6'),
      lang('JavaScript', 8_120, '#f1e05a'),
      lang('Shell', 1_450, '#89e051')
    ])
    expect(items.map((i) => [i.name, i.label, i.color])).toEqual([
      ['TypeScript', '84%', '#3178c6'],
      ['CSS', '11%', '#663399'],
      ['JavaScript', '4%', '#f1e05a'],
      ['Shell', '<1%', '#89e051']
    ])
    const sum = items.reduce((n, i) => n + i.percent, 0)
    expect(sum).toBeCloseTo(100, 6)
  })

  it('색이 없으면 이름에서 늘 같은 색을 만든다', () => {
    const [a] = languageBars([lang('Zig', 10)])
    const [b] = languageBars([lang('Zig', 99)])
    expect(a?.color).toBe(languageColor('Zig'))
    expect(b?.color).toBe(a?.color)
    expect(languageColor('Zig')).toMatch(/^hsl\(\d+ 55% 55%\)$/)
    expect(languageColor('Zig')).not.toBe(languageColor('Nim'))
  })

  it('상위 N 개 뒤는 "기타" 하나로 합친다', () => {
    const items = languageBars(
      [lang('A', 50), lang('B', 20), lang('C', 10), lang('D', 10), lang('E', 10)],
      2
    )
    expect(items.map((i) => i.name)).toEqual(['A', 'B', null])
    expect(items[2]?.color).toBe(OTHER_LANGUAGE_COLOR)
    expect(items[2]?.label).toBe('30%')
  })

  it('남는 언어가 하나뿐이면 합치지 않는다', () => {
    const items = languageBars([lang('A', 50), lang('B', 30), lang('C', 20)], 2)
    expect(items.map((i) => i.name)).toEqual(['A', 'B', 'C'])
  })

  it('비었거나 크기가 0 이면 빈 목록', () => {
    expect(languageBars([])).toEqual([])
    expect(languageBars([lang('A', 0)])).toEqual([])
  })
})

describe('기타 도우미', () => {
  it('formatPercent', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.004)).toBe('<1%')
    expect(formatPercent(0.962)).toBe('96%')
    expect(formatPercent(1)).toBe('100%')
  })

  it('labelColor 는 6자리 16진수만 받는다', () => {
    expect(labelColor('d73a4a')).toBe('#d73a4a')
    expect(labelColor('nope')).toBeNull()
    expect(labelColor(null)).toBeNull()
  })

  it('repoLink', () => {
    expect(repoLink('https://github.com/o/r', 'fork')).toBe('https://github.com/o/r/fork')
    expect(repoLink('https://github.com/o/r/', '/pulls')).toBe('https://github.com/o/r/pulls')
  })
})
