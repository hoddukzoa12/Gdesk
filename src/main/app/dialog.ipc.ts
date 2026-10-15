import { BrowserWindow, dialog } from 'electron'
import '@shared/ipc/dialog'
import { handle } from '../ipc/registry'

export function registerIpc(): void {
  handle('dialog:chooseFolder', async ({ defaultPath }, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      ...(defaultPath ? { defaultPath } : {})
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })
}
