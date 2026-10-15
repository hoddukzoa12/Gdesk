import '@shared/ipc/sync'
import type { SyncStatus } from '@shared/domain/sync'
import { emit, handle } from '../ipc/registry'
import { getGitHubClient } from '../github/client'
import { assertRepoId } from '../pins/pins.service'
import { getSyncEngine, onSyncStatus } from './index'

/** 엔진 전(initSync 전)에 상태를 물으면 요청 계층 상태만 담아 돌려준다 */
function fallbackStatus(): SyncStatus {
  let connection: SyncStatus['connection'] = 'online'
  try {
    connection = getGitHubClient().getStatus()
  } catch {
    // 클라이언트도 아직 없으면 online 으로 둔다
  }
  return {
    connection,
    lastSyncedAt: null,
    rateLimitedUntil: null,
    syncing: false,
    orgRestrictions: []
  }
}

// 엔진은 호출 시점에 가져온다(IPC 등록이 initSync 보다 먼저다).
export function registerIpc(): void {
  handle('sync:getStatus', () => getSyncEngine()?.getStatus() ?? fallbackStatus())
  handle('sync:refresh', async (req) => {
    await getSyncEngine()?.refresh(req?.scope)
  })
  handle('sync:setViewedRepo', (req) => {
    const repoId = req?.repoId ?? null
    if (repoId !== null) assertRepoId(repoId)
    // 진입 갱신은 기다리지 않는다(결과는 data:changed 로 다시 읽는다)
    void getSyncEngine()
      ?.setViewedRepo(repoId)
      .catch(() => undefined)
  })

  onSyncStatus((status) => emit('sync:status', status))
}
