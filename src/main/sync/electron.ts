import { BrowserWindow, app } from 'electron'

/**
 * 앱 창이 하나라도 열려 있는지 따라가 엔진에 알린다(spec §6: 창이 모두 닫히면 갱신을 멈춘다).
 * 이미 열린 창도 센다. 해제 함수를 돌려준다.
 */
export function trackWindowPresence(target: { setWindowsOpen(open: boolean): void }): () => void {
  const open = new Set<BrowserWindow>()
  let active = true
  const update = (): void => {
    if (active) target.setWindowsOpen(open.size > 0)
  }
  const watch = (win: BrowserWindow): void => {
    if (win.isDestroyed() || open.has(win)) return
    open.add(win)
    win.once('closed', () => {
      open.delete(win)
      update()
    })
  }
  const onCreated = (_event: unknown, win: BrowserWindow): void => {
    watch(win)
    update()
  }
  for (const win of BrowserWindow.getAllWindows()) watch(win)
  app.on('browser-window-created', onCreated)
  update()
  return () => {
    active = false
    app.off('browser-window-created', onCreated)
  }
}
