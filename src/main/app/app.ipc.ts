import { app, shell } from 'electron'
import type { AppPlatform } from '@shared/domain/app'
import '@shared/ipc/app'
import { handle } from '../ipc/registry'
import { isTestMode } from '../config'
import { openExternalSafe } from './external'

// 예시 IPC 모듈. 다른 기능도 `<기능>.ipc.ts` 에 registerIpc 를 두는 같은 형식을 따른다.
export function registerIpc(): void {
  handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform as AppPlatform,
    testMode: isTestMode()
  }))

  handle('app:openExternal', async ({ url }) => ({
    opened: await openExternalSafe(url, (safe) => shell.openExternal(safe))
  }))
}
