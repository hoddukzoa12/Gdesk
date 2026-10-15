import '@shared/ipc/local-test'
import { isTestMode } from '../config'
import { handle } from '../ipc/registry'
import { recordedLaunches } from './test-launcher'

export function registerIpc(): void {
  handle('local:testLaunches', () => {
    if (!isTestMode()) throw new Error('test mode only')
    return recordedLaunches()
  })
}
