import { describe, expect, it } from 'vitest'
import { parseLinkHeader } from './link'

describe('parseLinkHeader', () => {
  it('rel 별 주소를 돌려준다', () => {
    const header =
      '<https://api.github.com/repositories/1/issues?page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/issues?page=5>; rel="last", ' +
      '<https://api.github.com/repositories/1/issues?page=1>; rel="first prev"'
    expect(parseLinkHeader(header)).toEqual({
      next: 'https://api.github.com/repositories/1/issues?page=2',
      last: 'https://api.github.com/repositories/1/issues?page=5',
      first: 'https://api.github.com/repositories/1/issues?page=1',
      prev: 'https://api.github.com/repositories/1/issues?page=1'
    })
  })

  it('없거나 깨진 값은 빈 객체', () => {
    expect(parseLinkHeader(null)).toEqual({})
    expect(parseLinkHeader('')).toEqual({})
    expect(parseLinkHeader('garbage')).toEqual({})
  })
})
