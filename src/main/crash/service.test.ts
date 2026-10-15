import { describe, expect, it, vi } from 'vitest'
import type { CrashReport } from '@shared/domain/crash'
import { createCrashLimiter, createCrashService, type CrashServiceDeps } from './service'

describe('createCrashLimiter', () => {
  it('같은 오류는 잠깐 사이에 다시 보고하지 않는다(debounce)', () => {
    let t = 0
    const limiter = createCrashLimiter({ debounceMs: 1_000, maxReports: 10, now: () => t })
    expect(limiter.allow('a')).toBe(true)
    t = 500
    expect(limiter.allow('a')).toBe(false)
    // 계속 반복되는 동안에는 시계를 다시 맞춘다
    t = 1_400
    expect(limiter.allow('a')).toBe(false)
    expect(limiter.allow('b')).toBe(true)
    t = 2_500
    expect(limiter.allow('a')).toBe(true)
  })

  it('한 실행에서 보고 수를 제한한다(cap)', () => {
    const limiter = createCrashLimiter({ debounceMs: 0, maxReports: 3, now: () => 0 })
    expect(['a', 'b', 'c', 'd', 'e'].map((k) => limiter.allow(k))).toEqual([
      true,
      true,
      true,
      false,
      false
    ])
  })
})

function setup(overrides: Partial<CrashServiceDeps> = {}) {
  const shown: CrashReport[] = []
  let t = 0
  const deps: CrashServiceDeps = {
    env: () => ({ appVersion: '1.0.0', platform: 'linux', osVersion: '6.1' }),
    scrubContext: () => ({ homeDir: '/home/zed', login: 'zed' }),
    sendMode: () => 'issue',
    show: (report) => shown.push(report),
    log: () => {},
    now: () => t,
    ...overrides
  }
  const service = createCrashService(deps)
  return {
    service,
    shown,
    tick: (ms: number) => {
      t += ms
    }
  }
}

describe('createCrashService', () => {
  it('오류를 지운 보고서로 만들어 보여 주고 보관한다', () => {
    const { service, shown } = setup()
    const report = service.capture('main', new Error('zed broke /home/zed/x'))
    expect(report?.message).toBe('Error: <user> broke ~/x')
    expect(shown).toHaveLength(1)
    expect(service.pending()).toEqual([report])
    expect(service.get(report?.id ?? '')).toEqual(report)
  })

  it('같은 오류가 반복돼도 한 번만 띄우고, 실행당 3개까지만 띄운다', () => {
    const { service, shown, tick } = setup()
    const err = new Error('loop')
    for (let i = 0; i < 50; i++) service.capture('renderer', err)
    expect(shown).toHaveLength(1)
    service.capture('renderer', new Error('two'))
    service.capture('main', new Error('three'))
    service.capture('main', new Error('four'))
    tick(60_000)
    service.capture('main', new Error('five'))
    expect(shown.map((r) => r.message)).toEqual(['Error: loop', 'Error: two', 'Error: three'])
  })

  it('닫은 보고서는 대기 목록에서 빠진다', () => {
    const { service } = setup()
    const a = service.capture('main', new Error('a'))
    const b = service.capture('main', new Error('b'))
    service.dismiss(a?.id ?? '')
    expect(service.pending().map((r) => r.id)).toEqual([b?.id])
    expect(service.get(a?.id ?? '')).toBeNull()
  })

  it('문맥 읽기나 보여 주기가 실패해도 던지지 않는다(오류 고리 방지)', () => {
    const log = vi.fn()
    const { service } = setup({
      scrubContext: () => {
        throw new Error('db closed')
      },
      show: () => {
        throw new Error('window destroyed')
      },
      log
    })
    const report = service.capture('main', new Error('at /Users/amy/a.js'))
    expect(report?.message).toBe('Error: at ~/a.js')
    expect(log).toHaveBeenCalled()
  })

  it('보내기 방식을 보고서에 담는다', () => {
    const { service } = setup({ sendMode: () => 'copy' })
    expect(service.capture('main', 'x')?.sendMode).toBe('copy')
  })
})
