import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

// 화면에 노출하는 통로는 invoke/on 두 개뿐이다. 채널별 타입은 src/shared/ipc 의 계약을 따른다.
// 토큰 같은 민감 정보는 메인 프로세스가 응답에 넣지 않는다(spec 11-1).
const api = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(channel, ...args),
  on: (event: string, listener: (payload: unknown) => void): (() => void) => {
    const wrapped = (_e: IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(event, wrapped)
    return () => {
      ipcRenderer.removeListener(event, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('gdesk', api)
