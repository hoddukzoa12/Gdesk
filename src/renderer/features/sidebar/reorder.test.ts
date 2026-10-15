import { describe, expect, it } from 'vitest'
import { moveItem } from './reorder'

describe('moveItem', () => {
  it('위·아래로 옮긴다', () => {
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4])
    expect(moveItem([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3])
  })
  it('범위를 벗어나면 그대로', () => {
    const items = [1, 2]
    expect(moveItem(items, 0, -1)).toEqual([1, 2])
    expect(moveItem(items, 1, 2)).toEqual([1, 2])
    expect(moveItem(items, -1, 0)).toEqual([1, 2])
  })
})
