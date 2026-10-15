import { describe, expect, it } from 'vitest'
import type { RescanSession } from './rescan-triggers'
import { watchRescanTriggers } from './rescan-triggers'

function setup(initial: RescanSession | null) {
  let scans = 0
  let settingsListener: ((s: { cloneBaseDir: string }) => void) | null = null
  let authListener: ((s: RescanSession) => void) | null = null
  const off = watchRescanTriggers({
    rescan: async () => {
      scans++
    },
    settings: () => ({ cloneBaseDir: '/home/me/GitHub' }),
    onSettingsChanged: (l) => {
      settingsListener = l
      return () => {
        settingsListener = null
      }
    },
    session: () => initial,
    onAuthChanged: (l) => {
      authListener = l
      return () => {
        authListener = null
      }
    }
  })
  return {
    scans: () => scans,
    auth: (s: RescanSession) => authListener?.(s),
    settings: (dir: string) => settingsListener?.({ cloneBaseDir: dir }),
    off
  }
}

const user = (id: number) => ({ id })

describe('watchRescanTriggers: 자동 찾기 다시 돌리기', () => {
  it('로그아웃 상태에서 처음 로그인하면 다시 찾는다', () => {
    const t = setup({ state: 'signed_out', user: null })
    t.auth({ state: 'signing_in', user: null })
    expect(t.scans()).toBe(0)
    t.auth({ state: 'signed_in', user: user(1) })
    expect(t.scans()).toBe(1)
    // 로그인 상태 그대로의 다른 변경(배너 닫기 등)으로는 다시 찾지 않는다
    t.auth({ state: 'signed_in', user: user(1) })
    expect(t.scans()).toBe(1)
  })

  it('다른 계정으로 로그인하면(로그아웃을 거치든 아니든) 다시 찾는다', () => {
    const t = setup({ state: 'signed_in', user: user(1) })
    t.auth({ state: 'signed_in', user: user(2) })
    expect(t.scans()).toBe(1)
    t.auth({ state: 'signed_out', user: null })
    expect(t.scans()).toBe(1)
    t.auth({ state: 'signed_in', user: user(3) })
    expect(t.scans()).toBe(2)
  })

  it('세션 만료 뒤 다시 로그인해도 찾는다', () => {
    const t = setup({ state: 'signed_in', user: user(1) })
    t.auth({ state: 'expired', user: user(1) })
    t.auth({ state: 'signed_in', user: user(1) })
    expect(t.scans()).toBe(1)
  })

  it('클론 기본 폴더가 바뀔 때만 다시 찾고, 해제하면 더 반응하지 않는다', () => {
    const t = setup(null)
    t.settings('/home/me/GitHub')
    expect(t.scans()).toBe(0)
    t.settings('/home/me/code')
    expect(t.scans()).toBe(1)
    t.off()
    t.settings('/home/me/other')
    t.auth({ state: 'signed_in', user: user(1) })
    expect(t.scans()).toBe(1)
  })
})
