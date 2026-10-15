import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type {
  EventChannel,
  EventPayload,
  InvokeChannel,
  InvokeRequest,
  InvokeResponse
} from '@shared/ipc/contract'

export type InvokeHandler<C extends InvokeChannel> = (
  request: InvokeRequest<C>,
  event: IpcMainInvokeEvent
) => InvokeResponse<C> | Promise<InvokeResponse<C>>

/** 요청-응답 채널 핸들러 등록. 기능의 `*.ipc.ts` 안에서만 호출한다. */
export function handle<C extends InvokeChannel>(channel: C, handler: InvokeHandler<C>): void {
  ipcMain.handle(channel, (event, request: InvokeRequest<C>) => handler(request, event))
}

/** 모든 창에 이벤트를 보낸다. */
export function emit<E extends EventChannel>(event: E, payload: EventPayload<E>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(event, payload)
  }
}

interface IpcModule {
  registerIpc: () => void
}

/**
 * `src/main/**\/*.ipc.ts` 를 자동 수집해 등록한다. 기능 작업은 자기 폴더에 `<이름>.ipc.ts` 를 두고
 * `export function registerIpc()` 를 내보내기만 하면 된다(이 파일과 index.ts 는 고치지 않는다).
 */
export function registerAllIpc(): void {
  const modules = import.meta.glob<IpcModule>('../**/*.ipc.ts', { eager: true })
  for (const mod of Object.values(modules)) mod.registerIpc()
}
