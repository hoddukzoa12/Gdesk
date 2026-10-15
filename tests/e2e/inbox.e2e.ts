import type { Page } from '@playwright/test'
import { expect, test } from './support/fixtures'
import { invoke, openedExternalUrls, waitForAppShell } from './support/helpers'

// Inbox 화면 (spec §4.3, §6). 화면 언어가 OS 를 따르므로 문구 대신 data-testid 로 찾는다.

const SYNC_TIMEOUT = 20_000

async function openInbox(page: Page): Promise<void> {
  await waitForAppShell(page)
  await page.locator('[data-nav="inbox"]').click()
  await expect(page.getByTestId('inbox-page')).toBeVisible()
}

function rows(page: Page) {
  return page.locator('[data-testid^="inbox-row-"]')
}

async function waitForRows(page: Page): Promise<void> {
  await expect(rows(page)).toHaveCount(9, { timeout: SYNC_TIMEOUT })
  // 쓰기 가능 여부를 받아 완료 버튼이 켜질 때까지
  await expect(page.getByTestId('inbox-done-9001')).toBeEnabled()
}

test.describe('Inbox', () => {
  test('동기화 뒤 9개, 안 읽음 필터는 6개', async ({ page }) => {
    await openInbox(page)
    await waitForRows(page)
    await expect(page.locator('[data-testid^="inbox-row-"][data-state="unread"]')).toHaveCount(6)
    await page.getByTestId('inbox-filter-unread').click()
    await expect(rows(page)).toHaveCount(6)
    await page.getByTestId('inbox-filter-all').click()
    await expect(rows(page)).toHaveCount(9)
  })

  test('안 읽은 행을 누르면 페이지를 열고 읽음 처리한다', async ({ page, app, server }) => {
    await openInbox(page)
    await waitForRows(page)
    const row = page.getByTestId('inbox-row-9001')
    await expect(row).toHaveAttribute('data-state', 'unread')
    await row.getByRole('button').first().click()

    await expect
      .poll(() => openedExternalUrls(app))
      .toContain(`${server.webBase}/gdesk-org/gdesk-core/pull/13`)
    await server.waitForRequest('PATCH /notifications/threads/9001')
    await expect(row).toHaveAttribute('data-state', 'read')
  })

  test('완료하면 행이 사라지고 GitHub 에도 완료 처리된다', async ({ page, server }) => {
    await openInbox(page)
    await waitForRows(page)
    await page.getByTestId('inbox-done-9002').click()
    await expect(page.getByTestId('inbox-row-9002')).toHaveCount(0)
    await server.waitForRequest('DELETE /notifications/threads/9002')
    await expect(rows(page)).toHaveCount(8)
  })

  test('완료가 실패하면 오류를 보이고 행이 남는다', async ({ page, server }) => {
    await openInbox(page)
    await waitForRows(page)
    server.failNextWrites(1)
    await page.getByTestId('inbox-done-9003').click()
    await expect(page.getByTestId('inbox-error-9003')).toBeVisible()
    await expect(page.getByTestId('inbox-row-9003')).toBeVisible()
    expect(server.hasRequest('DELETE /notifications/threads/9003')).toBe(true)
    await expect(rows(page)).toHaveCount(9)
  })

  test('오프라인이면 완료 버튼이 꺼지고 눌러도 읽음 처리하지 않는다', async ({
    page,
    app,
    server
  }) => {
    await openInbox(page)
    await waitForRows(page)
    server.goOffline()
    await invoke(page, 'sync:refresh', { scope: 'inbox' }).catch(() => undefined)
    await expect(page.getByTestId('inbox-done-9001')).toBeDisabled()
    await expect(page.getByTestId('inbox-blocked-hint')).toBeVisible()
    for (const id of ['9001', '9004', '9009']) {
      await expect(page.getByTestId(`inbox-done-${id}`)).toBeDisabled()
    }

    await page.getByTestId('inbox-row-9004').getByRole('button').first().click()
    await expect.poll(async () => (await openedExternalUrls(app)).length).toBe(1)
    await expect(page.getByTestId('inbox-row-9004')).toHaveAttribute('data-state', 'unread')
    expect(server.hasRequest('PATCH /notifications/threads/9004')).toBe(false)
  })
})

test.describe('세분화 토큰', () => {
  test('목록 대신 알림을 쓸 수 없다는 안내를 보인다', async ({ server, launchGdesk }) => {
    server.setFineGrained(true)
    const { page } = await launchGdesk()
    await openInbox(page)
    await expect(page.getByTestId('inbox-unavailable')).toBeVisible({ timeout: SYNC_TIMEOUT })
    await expect(rows(page)).toHaveCount(0)
  })
})
