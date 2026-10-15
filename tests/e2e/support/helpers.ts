import { expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import type {
  GdeskApi,
  InvokeArgs,
  InvokeChannel,
  InvokeResponse
} from '../../../src/shared/ipc/contract'

/** 앱 틀(사이드바·상단 막대·본문)이 보일 때까지 기다린다 */
export async function waitForAppShell(page: Page, timeout = 20_000): Promise<void> {
  await expect(page.getByTestId('app-layout')).toBeVisible({ timeout })
}

/**
 * 화면(렌더러)에서 IPC 를 부른다: `window.gdesk.invoke(channel, ...args)`.
 * 응답 타입은 src/shared/ipc 의 계약을 따른다.
 */
export async function invoke<C extends InvokeChannel>(
  page: Page,
  channel: C,
  ...args: InvokeArgs<C>
): Promise<InvokeResponse<C>> {
  const result: unknown = await page.evaluate(
    ([ch, rest]) => {
      const api = (globalThis as unknown as { gdesk: GdeskApi }).gdesk
      const call = api.invoke as unknown as (c: string, ...a: unknown[]) => Promise<unknown>
      return call(ch, ...rest)
    },
    [channel as string, args as unknown[]] as const
  )
  return result as InvokeResponse<C>
}

declare global {
  // 메인 프로세스(app.evaluate) 안에서만 쓰는 기록용 전역
  var __gdeskOpenedExternal: string[] | undefined
}

/**
 * shell.openExternal 을 가짜로 바꿔 실제 브라우저가 열리지 않게 한다. 연 주소는 openedExternalUrls 로 본다.
 * 하네스가 앱을 띄울 때 기본으로 부른다.
 */
export async function stubOpenExternal(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    globalThis.__gdeskOpenedExternal = []
    shell.openExternal = async (url: string) => {
      globalThis.__gdeskOpenedExternal?.push(url)
    }
  })
}

/** 지금까지 앱이 "브라우저로 열기" 한 주소들 */
export async function openedExternalUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => [...(globalThis.__gdeskOpenedExternal ?? [])])
}
