import { homedir } from 'node:os'
import type { ElectronApplication, Page } from '@playwright/test'
import { REPO_ROOT, expect, test } from './support/fixtures'
import { invoke, openedExternalUrls, waitForAppShell } from './support/helpers'

// 오류 보고 대화상자(spec §9). 테스트 모드 전용 crash:testTrigger 로 처리되지 않은 오류를 일부러 낸다.
// 문구는 OS 언어에 따라 바뀌므로 역할(dialog·textbox·button·status)로 찾는다.

/** 보고서에 나오면 안 되는 절대 경로들 */
async function forbiddenPaths(app: ElectronApplication): Promise<string[]> {
  const appHome = await app.evaluate(({ app: electronApp }) => electronApp.getPath('home'))
  return [appHome, homedir(), REPO_ROOT]
}

async function openDialog(page: Page, where: 'main' | 'renderer') {
  await waitForAppShell(page)
  expect(await invoke(page, 'crash:testTrigger', { where })).toEqual({ accepted: true })
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

for (const where of ['main', 'renderer'] as const) {
  test(`${where} 오류: 미리보기에 절대 홈 경로가 없고, 보내기는 설정에 따라 이슈 열기 또는 복사`, async ({
    app,
    page
  }) => {
    const dialog = await openDialog(page, where)
    const preview = dialog.getByRole('textbox')
    await expect(preview).toHaveValue(new RegExp(`Gdesk crash test \\(${where}\\)`))
    const text = await preview.inputValue()

    // 홈·저장소 폴더 같은 절대 경로는 ~ 로 지워져 있다
    for (const path of await forbiddenPaths(app)) expect(text).not.toContain(path)
    expect(text).not.toMatch(/\/(?:Users|home)\/[^/\s~]/)
    expect(text).not.toMatch(/[A-Za-z]:[\\/]+Users[\\/]/i)

    // 보내기: 빌드에 GDESK_REPO 가 있으면 이슈 페이지, 없으면(화면 테스트 빌드 기본) 클립보드 복사
    const [report] = await invoke(page, 'crash:pending')
    if (!report) throw new Error('no pending crash report')
    expect(report.message).toContain('Gdesk crash test')
    await dialog.getByRole('button').last().click()
    await expect(dialog.getByRole('status')).not.toBeEmpty()
    if (report.sendMode === 'copy') {
      const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
      expect(copied).toBe(text)
      expect(await openedExternalUrls(app)).toEqual([])
    } else {
      await expect
        .poll(async () => (await openedExternalUrls(app)).some((u) => u.includes('/issues/new')))
        .toBe(true)
    }

    // 닫으면 대화상자가 사라지고 보고서도 버린다(아무것도 보내지 않는다)
    await dialog.getByRole('button').first().click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await invoke(page, 'crash:pending')).toEqual([])
  })
}
