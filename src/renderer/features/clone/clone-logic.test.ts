import { describe, expect, it } from 'vitest'
import en from '../../locales/en/clone.json'
import ko from '../../locales/ko/clone.json'
import type { LocalLink } from '@shared/domain/link'
import {
  CLONE_FAILURE_CODES,
  LINK_FAILURE_REASONS,
  OPEN_FAILURE_REASONS,
  cloneFailureKey,
  cloneTargetPath,
  fileManagerKey,
  httpsCloneUrl,
  linkFailureKey,
  menuMode,
  openFailureKey,
  pickLink,
  sshCloneUrl
} from './clone-logic'

function lookup(dict: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[part]
    return undefined
  }, dict)
}

function link(id: number, status: LocalLink['status'] = 'ok'): LocalLink {
  return { id, repoId: 101, path: `/work/${id}`, lastUsedAt: 1000 - id, status }
}

describe('실패 코드 → 문구', () => {
  it.each(CLONE_FAILURE_CODES)('클론 실패 %s 는 en·ko 문구가 있다', (code) => {
    const key = cloneFailureKey(code)
    expect(key).toBe(`cloneFailure.${code}`)
    expect(lookup(en, key)).toEqual(expect.any(String))
    expect(lookup(ko, key)).toEqual(expect.any(String))
  })

  it('모르는 클론 실패 코드는 git 오류 문구로', () => {
    expect(cloneFailureKey('weird')).toBe('cloneFailure.git_error')
  })

  it.each(LINK_FAILURE_REASONS)('연결 거부 %s 는 문구가 있다', (reason) => {
    const key = linkFailureKey(reason)
    expect(key).toBe(`linkFailure.${reason}`)
    expect(lookup(en, key)).toEqual(expect.any(String))
    expect(lookup(ko, key)).toEqual(expect.any(String))
  })

  it.each(OPEN_FAILURE_REASONS)('열기 실패 %s 는 문구가 있다', (reason) => {
    const key = openFailureKey(reason)
    expect(key).toBe(`openFailure.${reason}`)
    expect(lookup(en, key)).toEqual(expect.any(String))
    expect(lookup(ko, key)).toEqual(expect.any(String))
  })

  it('모르는 이유는 기본 문구로', () => {
    expect(linkFailureKey('x')).toBe('linkFailure.unresolved')
    expect(openFailureKey('x')).toBe('openFailure.launch_failed')
  })

  it('missing·no_editor 는 다시 연결·설정 안내 문구다', () => {
    expect(lookup(en, openFailureKey('missing'))).toMatch(/relink/i)
    expect(lookup(en, openFailureKey('no_editor'))).toMatch(/settings/i)
  })
})

describe('대상 경로', () => {
  it('기본 폴더 아래 저장소 이름', () => {
    expect(cloneTargetPath('/Users/me/GitHub', 'gdesk-demo', 'darwin')).toBe(
      '/Users/me/GitHub/gdesk-demo'
    )
  })

  it('끝 구분자를 뗀다', () => {
    expect(cloneTargetPath('/Users/me/GitHub/', 'x', 'linux')).toBe('/Users/me/GitHub/x')
    expect(cloneTargetPath('C:\\Users\\me\\GitHub\\', 'x', 'win32')).toBe(
      'C:\\Users\\me\\GitHub\\x'
    )
  })

  it('루트 폴더', () => {
    expect(cloneTargetPath('/', 'x', 'linux')).toBe('/x')
    expect(cloneTargetPath('D:\\', 'x', 'win32')).toBe('D:\\x')
  })

  it('플랫폼을 모르면 경로 모양으로 구분자를 고른다', () => {
    expect(cloneTargetPath('C:\\code', 'x')).toBe('C:\\code\\x')
    expect(cloneTargetPath('/code', 'x', null)).toBe('/code/x')
  })
})

describe('메뉴', () => {
  it('연결이 없으면 clone, 있으면 open', () => {
    expect(menuMode(undefined)).toBe('clone')
    expect(menuMode([])).toBe('clone')
    expect(menuMode([link(1)])).toBe('open')
  })

  it('고른 연결이 없으면 가장 최근 연결', () => {
    const links = [link(3), link(1, 'missing')]
    expect(pickLink(links, null)?.id).toBe(3)
    expect(pickLink(links, 1)?.id).toBe(1)
    expect(pickLink(links, 99)?.id).toBe(3)
    expect(pickLink([], null)).toBeUndefined()
  })

  it('클론 주소', () => {
    expect(httpsCloneUrl('octo', 'demo')).toBe('https://github.com/octo/demo.git')
    expect(sshCloneUrl('octo', 'demo')).toBe('git@github.com:octo/demo.git')
  })

  it('플랫폼별 파일 관리자 이름', () => {
    expect(fileManagerKey('darwin')).toBe('menu.showInFinder')
    expect(fileManagerKey('win32')).toBe('menu.showInExplorer')
    expect(fileManagerKey('linux')).toBe('menu.showInFiles')
    expect(fileManagerKey(null)).toBe('menu.showInFiles')
  })
})
