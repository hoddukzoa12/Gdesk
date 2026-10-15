import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'
import { buildMenuTemplate, menuLabels, resolveMenuLanguage } from './menu-template'

function flatten(items: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? flatten(item.submenu as MenuItemConstructorOptions[]) : [])
  ])
}

describe('resolveMenuLanguage', () => {
  it.each([
    ['ko', 'en-US', 'ko'],
    ['en', 'ko-KR', 'en'],
    ['system', 'ko-KR', 'ko'],
    ['system', 'ko', 'ko'],
    ['system', 'en-US', 'en'],
    ['system', 'ja-JP', 'en'],
    ['system', '', 'en']
  ] as const)('%s + OS %s → %s', (setting, locale, expected) => {
    expect(resolveMenuLanguage(setting, locale)).toBe(expected)
  })
})

describe('buildMenuTemplate', () => {
  for (const platform of ['darwin', 'win32', 'linux'] as const) {
    for (const isPackaged of [true, false]) {
      it(`${platform}(${isPackaged ? '포장' : '개발'}): 화면 새로고침 역할이 없고 모든 항목에 문구가 있다`, () => {
        const items = flatten(
          buildMenuTemplate({ platform, isPackaged, language: 'ko', appName: 'Gdesk' })
        )
        const roles = items.map((i) => i.role).filter(Boolean)
        expect(roles).not.toContain('reload')
        expect(roles).not.toContain('forceReload')
        expect(roles).not.toContain('viewMenu')
        expect(roles.includes('toggleDevTools')).toBe(!isPackaged)
        for (const item of items) {
          if (item.type === 'separator') continue
          expect(item.label, JSON.stringify(item)).toBeTruthy()
        }
        // ⌘R / Ctrl+R 단축키를 가진 항목도 없다
        expect(items.some((i) => /\+R$/i.test(String(i.accelerator ?? '')))).toBe(false)
      })
    }
  }

  it('한국어면 최상위·하위 문구가 한국어', () => {
    const template = buildMenuTemplate({
      platform: 'win32',
      isPackaged: true,
      language: 'ko',
      appName: 'Gdesk'
    })
    expect(template.map((i) => i.label)).toEqual(['파일', '편집', '보기', '윈도우'])
    const labels = flatten(template).map((i) => i.label)
    expect(labels).toContain('복사하기')
    expect(labels).toContain('Gdesk 종료')
    expect(labels).not.toContain('View')
  })

  it('영어면 영어, 맥은 앱 메뉴가 앞에 있고 윈도우 메뉴는 windowMenu 역할을 유지한다', () => {
    const template = buildMenuTemplate({
      platform: 'darwin',
      isPackaged: true,
      language: 'en',
      appName: 'Gdesk'
    })
    expect(template.map((i) => i.label)).toEqual(['Gdesk', 'File', 'Edit', 'View', 'Window'])
    expect(template[4]?.role).toBe('windowMenu')
    expect(flatten(template).map((i) => i.label)).toContain('Quit Gdesk')
  })

  it('en·ko 문구 키 집합이 같다', () => {
    expect(Object.keys(menuLabels('ko', 'X')).sort()).toEqual(
      Object.keys(menuLabels('en', 'X')).sort()
    )
  })
})
