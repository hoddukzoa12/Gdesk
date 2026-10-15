import '@shared/ipc/pins'
import { handle, emit } from '../ipc/registry'
import { onAccountDataCleared } from '../db/cleanup'
import { getDb } from '../db/db'
import { listPins, onPinsChanged, pinRepo, reorderPins, unpinRepo } from './pins.service'

// DB 는 호출 시점에 가져온다(등록이 DB 초기화보다 먼저일 수 있다).
export function registerIpc(): void {
  handle('pins:list', () => listPins(getDb()))
  handle('pins:pin', ({ repoId }) => pinRepo(getDb(), repoId))
  handle('pins:unpin', ({ repoId }) => unpinRepo(getDb(), repoId))
  handle('pins:reorder', ({ repoIds }) => reorderPins(getDb(), repoIds))

  onPinsChanged((pins) => emit('pins:changed', { pins }))
  onAccountDataCleared(() => emit('pins:changed', { pins: listPins(getDb()) }))
}
