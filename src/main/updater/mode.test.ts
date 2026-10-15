import { describe, expect, it } from 'vitest'
import {
  decideUpdateMode,
  detectLinuxPackage,
  parseRepo,
  releasesPageUrl,
  type UpdateModeInput
} from './mode'

const base: UpdateModeInput = {
  platform: 'win32',
  packaged: true,
  macSigned: false,
  repoConfigured: true,
  testMode: false,
  linuxPackage: 'unknown'
}

describe('decideUpdateMode — 플랫폼 표', () => {
  it.each([
    // [설명, 입력 일부, 방식, 첫 상태]
    ['윈도우 → 자동', { platform: 'win32' }, 'auto', 'idle'],
    ['윈도우는 맥 서명 여부와 무관', { platform: 'win32', macSigned: true }, 'auto', 'idle'],
    ['서명된 맥 → 자동', { platform: 'darwin', macSigned: true }, 'auto', 'idle'],
    ['서명 안 된 맥 → 알림만', { platform: 'darwin', macSigned: false }, 'notify', 'idle'],
    ['리눅스 AppImage → 자동', { platform: 'linux', linuxPackage: 'appimage' }, 'auto', 'idle'],
    ['리눅스 deb → 알림만', { platform: 'linux', linuxPackage: 'deb' }, 'notify', 'idle'],
    [
      '리눅스 알 수 없는 형식 → 알림만',
      { platform: 'linux', linuxPackage: 'unknown' },
      'notify',
      'idle'
    ],
    [
      '리눅스는 맥 서명 여부와 무관',
      { platform: 'linux', linuxPackage: 'deb', macSigned: true },
      'notify',
      'idle'
    ],
    ['지원 밖 OS → 알림만', { platform: 'freebsd' }, 'notify', 'idle']
  ] as const)('%s', (_name, patch, mode, initialState) => {
    expect(decideUpdateMode({ ...base, ...patch })).toEqual({ mode, initialState })
  })
})

describe('decideUpdateMode — 꺼지는 경우', () => {
  const platforms: Array<Partial<UpdateModeInput>> = [
    { platform: 'win32' },
    { platform: 'darwin', macSigned: true },
    { platform: 'darwin', macSigned: false },
    { platform: 'linux', linuxPackage: 'appimage' },
    { platform: 'linux', linuxPackage: 'deb' }
  ]

  it.each(platforms)('개발 실행(패키지 아님)이면 disabled: %o', (patch) => {
    expect(decideUpdateMode({ ...base, ...patch, packaged: false })).toEqual({
      mode: 'off',
      initialState: 'disabled'
    })
  })

  it.each(platforms)('테스트 모드면 disabled: %o', (patch) => {
    expect(decideUpdateMode({ ...base, ...patch, testMode: true })).toEqual({
      mode: 'off',
      initialState: 'disabled'
    })
  })

  it.each(platforms)('저장소가 없으면 unavailable: %o', (patch) => {
    expect(decideUpdateMode({ ...base, ...patch, repoConfigured: false })).toEqual({
      mode: 'off',
      initialState: 'unavailable'
    })
  })

  it('개발·테스트 실행이 저장소 미설정보다 먼저다', () => {
    expect(decideUpdateMode({ ...base, packaged: false, repoConfigured: false }).initialState).toBe(
      'disabled'
    )
    expect(decideUpdateMode({ ...base, testMode: true, repoConfigured: false }).initialState).toBe(
      'disabled'
    )
  })

  it('전체 조합에서 auto 는 윈도우·AppImage·서명된 맥뿐이다', () => {
    const bools = [true, false]
    for (const platform of ['win32', 'darwin', 'linux', 'freebsd'])
      for (const packaged of bools)
        for (const macSigned of bools)
          for (const repoConfigured of bools)
            for (const testMode of bools)
              for (const linuxPackage of ['appimage', 'deb', 'unknown'] as const) {
                const input = {
                  platform,
                  packaged,
                  macSigned,
                  repoConfigured,
                  testMode,
                  linuxPackage
                }
                const { mode } = decideUpdateMode(input)
                const live = packaged && repoConfigured && !testMode
                const autoCapable =
                  platform === 'win32' ||
                  (platform === 'darwin' && macSigned) ||
                  (platform === 'linux' && linuxPackage === 'appimage')
                expect(mode, JSON.stringify(input)).toBe(
                  !live ? 'off' : autoCapable ? 'auto' : 'notify'
                )
              }
  })
})

describe('detectLinuxPackage', () => {
  it('APPIMAGE 환경 변수가 있으면 appimage', () => {
    expect(detectLinuxPackage({ appImagePath: '/home/a/Gdesk.AppImage', packageType: null })).toBe(
      'appimage'
    )
    expect(detectLinuxPackage({ appImagePath: '/x.AppImage', packageType: 'deb' })).toBe('appimage')
  })

  it('package-type 파일이 deb 이면 deb', () => {
    expect(detectLinuxPackage({ appImagePath: undefined, packageType: 'deb\n' })).toBe('deb')
  })

  it('그 밖에는 unknown', () => {
    expect(detectLinuxPackage({ appImagePath: '', packageType: null })).toBe('unknown')
    expect(detectLinuxPackage({ appImagePath: undefined, packageType: 'rpm' })).toBe('unknown')
  })
})

describe('parseRepo', () => {
  it.each([
    ['hoddukzoa/gdesk', { owner: 'hoddukzoa', repo: 'gdesk' }],
    ['  my-org/my.repo_1  ', { owner: 'my-org', repo: 'my.repo_1' }]
  ])('%s', (raw, expected) => {
    expect(parseRepo(raw)).toEqual(expected)
  })

  it.each(['', 'gdesk', 'a/b/c', '/gdesk', 'owner/', 'https://github.com/a/b', 'a b/c', 'a/..'])(
    '잘못된 값 %j → null',
    (raw) => {
      expect(parseRepo(raw)).toBeNull()
    }
  )
})

describe('releasesPageUrl', () => {
  it('GitHub Releases 최신 페이지 주소', () => {
    expect(releasesPageUrl({ owner: 'hoddukzoa', repo: 'gdesk' })).toBe(
      'https://github.com/hoddukzoa/gdesk/releases/latest'
    )
  })
})
