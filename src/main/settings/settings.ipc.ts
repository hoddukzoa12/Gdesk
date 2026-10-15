import '@shared/ipc/settings'
import { handle, emit } from '../ipc/registry'
import { getDb } from '../db/db'
import { getSettings, onSettingsChanged, updateSettings } from './settings.service'

// DB 는 호출 시점에 가져온다(등록이 DB 초기화보다 먼저일 수 있다).
export function registerIpc(): void {
  handle('settings:get', () => getSettings(getDb()))
  handle('settings:update', (patch) => updateSettings(getDb(), patch))

  onSettingsChanged((settings) => emit('settings:changed', settings))
}
