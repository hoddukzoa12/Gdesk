import '@shared/ipc/local'
import { handle } from '../ipc/registry'
import { getLocalService } from './index'

// 서비스는 호출 시점에 가져온다(등록이 initLocal 보다 먼저다). 진행률 이벤트는 서비스가 보낸다.
export function registerIpc(): void {
  handle('local:listLinks', (request) => getLocalService().listLinks(request ?? {}))
  handle('local:listEditors', () => getLocalService().listEditors())
  handle('local:clone', (request) => getLocalService().clone(request))
  handle('local:cancelClone', (request) => getLocalService().cancelClone(request))
  handle('local:rescan', () => getLocalService().rescan())
  handle('local:link', (request) => getLocalService().link(request))
  handle('local:unlink', (request) => getLocalService().unlink(request))
  handle('local:relink', (request) => getLocalService().relink(request))
  handle('local:open', (request) => getLocalService().open(request))
}
