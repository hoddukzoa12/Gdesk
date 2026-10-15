import '@shared/ipc/updater'
import { handle } from '../ipc/registry'
import { getUpdater } from './updater'

export function registerIpc(): void {
  handle('updater:getStatus', () => getUpdater().getStatus())
  handle('updater:check', () => getUpdater().check())
  handle('updater:install', () => ({ accepted: getUpdater().install() }))
  handle('updater:openDownloadPage', async () => ({
    opened: await getUpdater().openDownloadPage()
  }))
}
