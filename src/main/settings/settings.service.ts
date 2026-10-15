import { homedir as osHomedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import {
  CLONE_PROTOCOLS,
  LANGUAGE_SETTINGS,
  SETTINGS_KEYS,
  THEME_SETTINGS,
  type HomeCardSetting,
  type Settings,
  type SettingsKey,
  type SettingsPatch
} from '@shared/domain/settings'
import { withTransaction } from '../db/transaction'

/**
 * 설정 서비스(spec 4.13). 필드마다 settings 테이블에 JSON 으로 저장하고,
 * 저장하지 않은 필드는 기본값을 쓴다(기본값은 저장하지 않으므로 클론 폴더 기본값은 실행 시 홈 폴더를 따른다).
 * 설정은 계정과 무관하며 계정 단위 삭제에서도 지우지 않는다.
 */

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettingsValidationError'
  }
}

export function defaultSettings(homedir: string = osHomedir()): Settings {
  return {
    cloneBaseDir: join(homedir, 'GitHub'),
    cloneProtocol: 'https',
    defaultEditor: null,
    language: 'system',
    theme: 'system',
    homeCards: []
  }
}

function fail(message: string): never {
  throw new SettingsValidationError(message)
}

function oneOf<T extends string>(key: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(`Invalid ${key}: ${JSON.stringify(value)}`)
  }
  return value as T
}

function validateHomeCards(value: unknown): HomeCardSetting[] {
  if (!Array.isArray(value)) fail('Invalid homeCards: must be an array')
  const seen = new Set<string>()
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) fail('Invalid homeCards item')
    const { id, enabled } = item as Record<string, unknown>
    if (typeof id !== 'string' || id === '') fail('Invalid homeCards item id')
    if (typeof enabled !== 'boolean') fail(`Invalid homeCards enabled for "${id}"`)
    if (seen.has(id)) fail(`Duplicate homeCards id "${id}"`)
    seen.add(id)
    return { id, enabled }
  })
}

/** 필드 하나의 값을 검사해 정리된 값을 돌려준다. */
function validateField<K extends SettingsKey>(key: K, value: unknown): Settings[K] {
  switch (key) {
    case 'cloneBaseDir':
      if (typeof value !== 'string' || value.trim() === '' || !isAbsolute(value)) {
        fail('Invalid cloneBaseDir: must be an absolute path')
      }
      return value as Settings[K]
    case 'cloneProtocol':
      return oneOf(key, value, CLONE_PROTOCOLS) as Settings[K]
    case 'defaultEditor':
      if (value !== null && (typeof value !== 'string' || value === '')) {
        fail('Invalid defaultEditor: must be a non-empty string or null')
      }
      return value as Settings[K]
    case 'language':
      return oneOf(key, value, LANGUAGE_SETTINGS) as Settings[K]
    case 'theme':
      return oneOf(key, value, THEME_SETTINGS) as Settings[K]
    case 'homeCards':
      return validateHomeCards(value) as Settings[K]
    default:
      return fail(`Unknown setting "${String(key)}"`)
  }
}

function isSettingsKey(key: string): key is SettingsKey {
  return (SETTINGS_KEYS as readonly string[]).includes(key)
}

/** 화면에서 온 패치를 검사한다. 모르는 키나 잘못된 값이 있으면 SettingsValidationError. */
export function validateSettingsPatch(patch: unknown): SettingsPatch {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    fail('Settings patch must be an object')
  }
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!isSettingsKey(key)) fail(`Unknown setting "${key}"`)
    result[key] = validateField(key, value)
  }
  return result as SettingsPatch
}

export function getSettings(db: DatabaseSync, homedir: string = osHomedir()): Settings {
  const settings = defaultSettings(homedir)
  const target = settings as unknown as Record<SettingsKey, unknown>
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    const key = String(row.key)
    if (!isSettingsKey(key)) continue
    try {
      target[key] = validateField(key, JSON.parse(String(row.value)))
    } catch {
      // 깨진 값은 무시하고 기본값을 쓴다
    }
  }
  return settings
}

type SettingsListener = (settings: Settings) => void
const listeners = new Set<SettingsListener>()

/** 설정이 바뀔 때 알림을 받는다. 해제 함수를 돌려준다. */
export function onSettingsChanged(listener: SettingsListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 패치를 검사해 저장하고 바뀐 전체 설정을 돌려준다. 잘못된 패치는 아무것도 저장하지 않는다. */
export function updateSettings(
  db: DatabaseSync,
  patch: unknown,
  homedir: string = osHomedir()
): Settings {
  const valid = validateSettingsPatch(patch)
  const entries = Object.entries(valid)
  if (entries.length > 0) {
    const upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    withTransaction(db, () => {
      for (const [key, value] of entries) upsert.run(key, JSON.stringify(value))
    })
  }
  const settings = getSettings(db, homedir)
  if (entries.length > 0) for (const listener of [...listeners]) listener(settings)
  return settings
}
