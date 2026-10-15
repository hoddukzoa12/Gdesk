import '@shared/ipc/actions'
import { getAuthService, onAuthChanged } from '../auth'
import { getDb } from '../db/db'
import { getGitHubClient } from '../github/client'
import { notifyDataChanged } from '../ipc/data-events'
import { emit, handle } from '../ipc/registry'
import { createActionsService } from './actions.service'

// 쓰기 동작(스타, 알림 읽음·완료). GitHub 클라이언트는 index.ts 에서 registerAllIpc() 전에 만들어지므로
// 여기서 바로 상태 변화를 구독한다. DB·세션은 호출 시점에 가져온다.
export function registerIpc(): void {
  const service = createActionsService({
    db: getDb,
    client: getGitHubClient(),
    getSession: () => getAuthService().getSession(),
    notify: notifyDataChanged,
    onAuthChanged: (listener) => onAuthChanged(() => listener())
  })

  handle('actions:star', ({ repoId, starred }) => service.star(repoId, starred))
  handle('actions:markRead', ({ threadId }) => service.markRead(threadId))
  handle('actions:markDone', ({ threadId }) => service.markDone(threadId))
  handle('actions:getAvailability', () => service.getAvailability())

  service.onAvailabilityChange((availability) => emit('actions:availability', availability))
}
