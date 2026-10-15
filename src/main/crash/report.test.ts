import { describe, expect, it } from 'vitest'
import { crashReportText } from '@shared/domain/crash'
import {
  ISSUE_URL_MAX_LENGTH,
  buildCrashReport,
  buildIssueUrl,
  normalizeError,
  osDisplayName
} from './report'

const env = { appVersion: '1.2.3', platform: 'darwin', osVersion: '15.1.0' }

describe('normalizeError', () => {
  it('Error 는 이름·메시지·스택을 쓴다', () => {
    const err = new TypeError('x is undefined')
    const info = normalizeError(err)
    expect(info.message).toBe('TypeError: x is undefined')
    expect(info.stack).toContain('x is undefined')
  })

  it('Error 가 아닌 값도 글로 바꾼다', () => {
    expect(normalizeError('boom')).toEqual({ message: 'boom', stack: '' })
    expect(normalizeError({ code: 42 })).toEqual({ message: '{"code":42}', stack: '' })
    expect(normalizeError(undefined)).toEqual({ message: 'undefined', stack: '' })
  })

  it('너무 긴 메시지와 스택은 자른다', () => {
    const info = normalizeError({ message: 'm'.repeat(10_000), stack: 's'.repeat(100_000) })
    expect(info.message.length).toBeLessThanOrEqual(2_000)
    expect(info.stack.length).toBeLessThanOrEqual(16_000)
  })
})

describe('osDisplayName', () => {
  it.each([
    ['darwin', 'macOS'],
    ['win32', 'Windows'],
    ['linux', 'Linux'],
    ['freebsd', 'freebsd']
  ])('%s → %s', (platform, name) => {
    expect(osDisplayName(platform)).toBe(name)
  })
})

describe('buildCrashReport', () => {
  it('버전·OS·프로세스·메시지·스택을 담고 민감 정보를 지운다', () => {
    const report = buildCrashReport({
      id: 'c1',
      process: 'main',
      error: {
        message: 'Error: sync failed for acme/secret at /Users/alice/x',
        stack: 'Error: sync failed\n    at run (/Users/alice/app/a.js:1:1)'
      },
      env,
      scrub: { homeDir: '/Users/alice', repos: ['acme/secret'], owners: ['acme'] },
      sendMode: 'issue'
    })
    expect(report).toMatchObject({
      id: 'c1',
      process: 'main',
      appVersion: '1.2.3',
      osName: 'macOS',
      osVersion: '15.1.0',
      message: 'Error: sync failed for <repo> at ~/x',
      stack: 'Error: sync failed\n    at run (~/app/a.js:1:1)',
      sendMode: 'issue'
    })
    expect(report.title).toBe('[crash] main: Error: sync failed for <repo> at ~/x')
    expect(report.body).toContain('1.2.3')
    expect(report.body).toContain('macOS 15.1.0')
    expect(report.body).toContain('main')
    expect(report.body).toContain('Error: sync failed for <repo> at ~/x')
    expect(report.body).toContain('at run (~/app/a.js:1:1)')
    expect(report.body).not.toContain('alice')
    expect(report.body).not.toContain('acme')
  })

  it('제목은 첫 줄만 쓰고 길면 자른다', () => {
    const report = buildCrashReport({
      id: 'c2',
      process: 'renderer',
      error: { message: `${'x'.repeat(300)}\nsecond line`, stack: '' },
      env,
      scrub: {},
      sendMode: 'copy'
    })
    expect(report.title.startsWith('[crash] renderer: xxx')).toBe(true)
    expect(report.title.length).toBeLessThanOrEqual(120)
    expect(report.title).not.toContain('second line')
  })

  it('메시지 안의 ``` 때문에 코드 블록이 깨지지 않는다', () => {
    const report = buildCrashReport({
      id: 'c3',
      process: 'main',
      error: { message: 'bad ``` fence', stack: '' },
      env,
      scrub: {},
      sendMode: 'issue'
    })
    expect(report.body).toContain('````\nbad ``` fence\n````')
  })

  it('미리보기·복사 글은 제목과 본문을 함께 담는다', () => {
    const report = buildCrashReport({
      id: 'c4',
      process: 'main',
      error: { message: 'oops', stack: '' },
      env,
      scrub: {},
      sendMode: 'copy'
    })
    expect(crashReportText(report)).toBe(`${report.title}\n\n${report.body}`)
  })
})

describe('buildIssueUrl', () => {
  it('제목과 본문을 URL 인코딩해 새 이슈 주소를 만든다', () => {
    const { url, truncated } = buildIssueUrl('hoddukzoa/gdesk', 'a & b', 'line 1\nline #2 한글')
    expect(truncated).toBe(false)
    expect(url).toBe(
      'https://github.com/hoddukzoa/gdesk/issues/new?title=a%20%26%20b&body=' +
        encodeURIComponent('line 1\nline #2 한글')
    )
    const parsed = new URL(url)
    expect(parsed.searchParams.get('title')).toBe('a & b')
    expect(parsed.searchParams.get('body')).toBe('line 1\nline #2 한글')
  })

  it('너무 길면 본문을 잘라 (truncated) 를 붙이고 길이 제한을 지킨다', () => {
    const body = '가나다라마바사'.repeat(2_000)
    const { url, truncated } = buildIssueUrl('o/r', 'title', body)
    expect(truncated).toBe(true)
    expect(url.length).toBeLessThanOrEqual(ISSUE_URL_MAX_LENGTH)
    const decoded = new URL(url).searchParams.get('body') ?? ''
    expect(decoded.endsWith('(truncated)')).toBe(true)
    expect(body.startsWith(decoded.replace(/\n*\(truncated\)$/, ''))).toBe(true)
    // 거의 꽉 채운다
    expect(url.length).toBeGreaterThan(ISSUE_URL_MAX_LENGTH - 20)
  })

  it('서로게이트 쌍(이모지)을 반으로 자르지 않는다', () => {
    const body = '😀'.repeat(5_000)
    expect(() => buildIssueUrl('o/r', 't', body, 1_000)).not.toThrow()
    const { url } = buildIssueUrl('o/r', 't', body, 1_000)
    expect(url.length).toBeLessThanOrEqual(1_000)
  })

  it('잘못된 저장소 주소는 거부한다', () => {
    expect(() => buildIssueUrl('not a repo', 't', 'b')).toThrow()
    expect(() => buildIssueUrl('a/b/c', 't', 'b')).toThrow()
  })
})
