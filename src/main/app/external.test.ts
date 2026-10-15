import { describe, expect, it, vi } from 'vitest'
import { isSafeExternalUrl, openExternalSafe } from './external'

describe('isSafeExternalUrl', () => {
  it.each([
    ['https://github.com/owner/repo/pull/1', true],
    ['http://example.com', true],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['vscode://file/tmp', false],
    ['not a url', false],
    ['', false]
  ])('%s → %s', (url, expected) => {
    expect(isSafeExternalUrl(url)).toBe(expected)
  })
})

describe('openExternalSafe', () => {
  it('안전한 주소만 연다', async () => {
    const open = vi.fn().mockResolvedValue(undefined)
    await expect(openExternalSafe('https://github.com', open)).resolves.toBe(true)
    await expect(openExternalSafe('file:///tmp', open)).resolves.toBe(false)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://github.com')
  })
})
