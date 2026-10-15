import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../db/connection'
import {
  SettingsValidationError,
  defaultSettings,
  getSettings,
  onSettingsChanged,
  updateSettings,
  validateSettingsPatch
} from './settings.service'

const home = '/home/tester'

describe('settings defaults', () => {
  it('기본값, 클론 폴더는 홈 폴더 아래 GitHub', () => {
    expect(defaultSettings(home)).toEqual({
      cloneBaseDir: join(home, 'GitHub'),
      cloneProtocol: 'https',
      defaultEditor: null,
      language: 'system',
      theme: 'system',
      homeCards: []
    })
  })

  it('저장된 값이 없으면 기본값을 돌려주고, 클론 폴더는 실행 시 홈 폴더를 따른다', () => {
    const db = openDatabase(':memory:')
    expect(getSettings(db, home)).toEqual(defaultSettings(home))
    expect(getSettings(db, '/other').cloneBaseDir).toBe(join('/other', 'GitHub'))
    db.close()
  })
})

describe('validateSettingsPatch', () => {
  it('올바른 패치를 통과시킨다', () => {
    const patch = {
      cloneBaseDir: '/data/src',
      cloneProtocol: 'ssh',
      defaultEditor: 'vscode',
      language: 'ko',
      theme: 'dark',
      homeCards: [
        { id: 'issues', enabled: true },
        { id: 'prs', enabled: false }
      ]
    }
    expect(validateSettingsPatch(patch)).toEqual(patch)
    expect(validateSettingsPatch({ defaultEditor: null })).toEqual({ defaultEditor: null })
    expect(validateSettingsPatch({})).toEqual({})
  })

  it.each([
    ['객체가 아님', null],
    ['배열', []],
    ['모르는 키', { foo: 1 }],
    ['잘못된 프로토콜', { cloneProtocol: 'git' }],
    ['잘못된 언어', { language: 'ja' }],
    ['잘못된 테마', { theme: 'blue' }],
    ['빈 클론 폴더', { cloneBaseDir: '' }],
    ['상대 경로 클론 폴더', { cloneBaseDir: 'relative/dir' }],
    ['숫자 편집기', { defaultEditor: 3 }],
    ['빈 편집기', { defaultEditor: '' }],
    ['홈 카드가 배열 아님', { homeCards: 'x' }],
    ['홈 카드 형식 오류', { homeCards: [{ id: 'a' }] }],
    ['홈 카드 enabled 타입', { homeCards: [{ id: 'a', enabled: 'yes' }] }],
    ['홈 카드 빈 id', { homeCards: [{ id: '', enabled: true }] }],
    [
      '홈 카드 중복 id',
      {
        homeCards: [
          { id: 'a', enabled: true },
          { id: 'a', enabled: false }
        ]
      }
    ],
    ['undefined 값', { theme: undefined }]
  ])('%s → 거부', (_label, patch) => {
    expect(() => validateSettingsPatch(patch)).toThrow(SettingsValidationError)
  })

  it('홈 카드의 여분 필드는 버린다', () => {
    expect(validateSettingsPatch({ homeCards: [{ id: 'a', enabled: true, extra: 1 }] })).toEqual({
      homeCards: [{ id: 'a', enabled: true }]
    })
  })
})

describe('updateSettings', () => {
  let db: DatabaseSync

  beforeEach(() => {
    db = openDatabase(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('패치한 필드만 바꾸고 전체 설정을 돌려준다', () => {
    const result = updateSettings(db, { theme: 'light' }, home)
    expect(result).toEqual({ ...defaultSettings(home), theme: 'light' })
    expect(getSettings(db, home)).toEqual(result)
    updateSettings(db, { defaultEditor: 'vscode' }, home)
    expect(getSettings(db, home)).toMatchObject({ theme: 'light', defaultEditor: 'vscode' })
    updateSettings(db, { defaultEditor: null }, home)
    expect(getSettings(db, home).defaultEditor).toBeNull()
  })

  it('잘못된 패치는 아무것도 바꾸지 않는다', () => {
    expect(() =>
      updateSettings(db, { theme: 'dark', language: 'xx' } as unknown as object, home)
    ).toThrow(SettingsValidationError)
    expect(getSettings(db, home)).toEqual(defaultSettings(home))
  })

  it('변경 알림을 보낸다', () => {
    const listener = vi.fn()
    const off = onSettingsChanged(listener)
    updateSettings(db, { language: 'en' }, home)
    expect(listener).toHaveBeenCalledWith({ ...defaultSettings(home), language: 'en' })
    off()
    updateSettings(db, { language: 'ko' }, home)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('저장된 값이 깨져 있으면 그 필드만 기본값으로 돌아간다', () => {
    updateSettings(db, { theme: 'dark', language: 'ko' }, home)
    db.prepare("UPDATE settings SET value = ? WHERE key = 'theme'").run('"purple"')
    db.prepare("UPDATE settings SET value = ? WHERE key = 'language'").run('{not json')
    expect(getSettings(db, home)).toEqual(defaultSettings(home))
  })
})

describe('settings persistence', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gdesk-settings-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('다시 열어도 설정이 남는다', () => {
    const file = join(dir, 'gdesk.db')
    const db1 = openDatabase(file)
    updateSettings(
      db1,
      {
        cloneProtocol: 'ssh',
        cloneBaseDir: '/work/code',
        homeCards: [{ id: 'a', enabled: false }]
      },
      home
    )
    db1.close()

    const db2 = openDatabase(file)
    expect(getSettings(db2, home)).toEqual({
      ...defaultSettings(home),
      cloneProtocol: 'ssh',
      cloneBaseDir: '/work/code',
      homeCards: [{ id: 'a', enabled: false }]
    })
    db2.close()
  })

  it('파일 DB 는 WAL 모드로 열고 없는 폴더를 만든다', () => {
    const db = openDatabase(join(dir, 'nested', 'gdesk.db'))
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    db.close()
  })
})
