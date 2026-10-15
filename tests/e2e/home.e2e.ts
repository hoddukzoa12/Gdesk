import type { Page } from '@playwright/test'
import { expect, test } from './support/fixtures'
import { invoke, openedExternalUrls, waitForAppShell } from './support/helpers'

// Home 할 일 요약 (spec §4.2): 동기화 뒤 다섯 카드, 항목 열기, 카드 끄기.

const CARD_IDS = ['reviewRequests', 'unreadNotifications', 'failedCi', 'unanswered', 'starChanges']

function card(page: Page, id: string) {
  return page.getByTestId(`home-card-${id}`)
}

/** 카드 머리의 개수 배지 */
function cardCount(page: Page, id: string, count: number) {
  return card(page, id).locator('header').getByText(String(count), { exact: true })
}

async function openHomeAfterSync(page: Page): Promise<void> {
  await waitForAppShell(page)
  await expect(page.getByTestId('home-page')).toBeVisible()
  // 동기화가 끝나 리뷰 요청이 채워질 때까지 기다린다
  await expect(cardCount(page, 'reviewRequests', 3)).toBeVisible({ timeout: 20_000 })
}

test('동기화 뒤 다섯 카드와 개수가 보인다', async ({ page }) => {
  await openHomeAfterSync(page)
  for (const id of CARD_IDS) await expect(card(page, id)).toBeVisible()
  await expect(cardCount(page, 'unreadNotifications', 6)).toBeVisible()
  await expect(page.getByTestId('home-row-unanswered-101-42')).toBeVisible()
  // 실패한 CI (b): 내 PR 301#77
  await expect(page.getByTestId('home-row-failedCi-pr-301-77')).toBeVisible()
})

test('리뷰 요청 행을 누르면 GitHub PR 페이지를 브라우저로 연다', async ({ app, page, server }) => {
  await openHomeAfterSync(page)
  await page.getByTestId('home-row-reviewRequests-201-13').getByRole('button').click()
  await expect
    .poll(() => openedExternalUrls(app))
    .toContain(`${server.webBase}/gdesk-org/gdesk-core/pull/13`)
})

test('설정에서 카드를 끄면 사라지고 나머지는 남는다', async ({ page }) => {
  await openHomeAfterSync(page)
  await expect(card(page, 'failedCi')).toBeVisible()
  await invoke(page, 'settings:update', { homeCards: [{ id: 'failedCi', enabled: false }] })
  await expect(card(page, 'failedCi')).toHaveCount(0)
  for (const id of CARD_IDS.filter((c) => c !== 'failedCi')) {
    await expect(card(page, id)).toBeVisible()
  }
})
