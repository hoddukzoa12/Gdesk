import type { Page } from '@playwright/test'
import { expect, test } from './support/fixtures'
import { FIXTURE } from '../fixtures/github'
import { invoke, openedExternalUrls, waitForAppShell } from './support/helpers'

// Home (spec §4.2, §5): 인사말, 영역 열 개(수치·고정 저장소·기여 달력·최근 커밋·내 PR·할 일 카드 다섯),
// 항목 열기, 영역 끄기, 고정·고정 해제.

const CARD_IDS = ['reviewRequests', 'unreadNotifications', 'failedCi', 'unanswered', 'starChanges']
const SECTION_IDS = [
  'stats',
  'pinnedRepos',
  'contributions',
  'recentCommits',
  'myPullRequests',
  ...CARD_IDS
]
const SYNC_TIMEOUT = 20_000

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
  await expect(cardCount(page, 'reviewRequests', 3)).toBeVisible({ timeout: SYNC_TIMEOUT })
}

test('동기화 뒤 영역 열 개와 할 일 카드 개수가 보인다', async ({ page }) => {
  await openHomeAfterSync(page)
  for (const id of SECTION_IDS) await expect(card(page, id)).toBeVisible()
  await expect(page.getByTestId(/^home-card-[A-Za-z]+$/)).toHaveCount(10)
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
  for (const id of SECTION_IDS.filter((c) => c !== 'failedCi')) {
    await expect(card(page, id)).toBeVisible()
  }
})

test('인사말·수치·기여 달력·최근 커밋·내 PR 이 가짜 GitHub 값으로 보인다', async ({ page }) => {
  await openHomeAfterSync(page)
  await expect(page.getByTestId('home-greeting').getByRole('heading', { level: 1 })).toHaveText(
    new RegExp(`${FIXTURE.viewer.name}|${FIXTURE.viewer.login}`)
  )
  await expect(page.getByTestId('home-quote')).not.toBeEmpty()

  await expect(page.getByTestId('home-stat-commits-value')).toHaveText(
    String(FIXTURE.contributions.totalCommits),
    { timeout: SYNC_TIMEOUT }
  )
  await expect(page.getByTestId('home-stat-streak-value')).toHaveText(
    new RegExp(`^${FIXTURE.contributions.streak}( days|일)$`)
  )

  const heatmap = page.getByTestId('home-heatmap')
  await expect(heatmap).toBeVisible()
  await expect(heatmap.getByTestId('home-heat-cell').first()).toBeVisible({
    timeout: SYNC_TIMEOUT
  })
  // 마지막 칸(오늘)은 마지막 열에 있다
  await expect(heatmap.getByTestId('home-heat-cell').last()).toHaveAttribute('data-col', '52')
  await expect(page.getByTestId('home-heatmap-empty')).toHaveCount(0)

  const commits = card(page, 'recentCommits')
  await expect(commits.getByText(FIXTURE.recentCommitMessages[0], { exact: true })).toBeVisible({
    timeout: SYNC_TIMEOUT
  })

  const awesome = FIXTURE.repos.starredOther.id
  await expect(page.getByTestId(`home-pr-${awesome}-77-status`)).toHaveAttribute(
    'data-status',
    'review_required',
    { timeout: SYNC_TIMEOUT }
  )
  await expect(page.getByTestId(`home-pr-${awesome}-78-status`)).toHaveAttribute(
    'data-status',
    'approved'
  )
})

test('최근 커밋 줄을 누르면 GitHub 커밋 페이지를 연다', async ({ app, page }) => {
  await openHomeAfterSync(page)
  const row = card(page, 'recentCommits')
    .getByRole('button')
    .filter({ hasText: FIXTURE.recentCommitMessages[0] })
  await expect(row).toBeVisible({ timeout: SYNC_TIMEOUT })
  await row.click()
  await expect
    .poll(async () => (await openedExternalUrls(app)).some((u) => u.includes('/commit/')))
    .toBe(true)
})

test('설정에서 새 영역(기여 달력)을 끄면 Home 에서 사라진다', async ({ page }) => {
  await openHomeAfterSync(page)
  await expect(card(page, 'contributions')).toBeVisible()
  const sections = (await invoke(page, 'settings:get')).homeCards
  expect(sections).toEqual([])
  await invoke(page, 'settings:update', {
    homeCards: SECTION_IDS.map((id) => ({ id, enabled: id !== 'contributions' }))
  })
  await expect(card(page, 'contributions')).toHaveCount(0)
  await expect(page.getByTestId('home-heatmap')).toHaveCount(0)
  await expect(page.getByTestId(/^home-card-[A-Za-z]+$/)).toHaveCount(9)
})

test('저장소를 고정하면 카드로 보이고, 카드의 핀으로 고정 해제한다', async ({ page }) => {
  const demo = FIXTURE.repos.demo
  await openHomeAfterSync(page)
  await expect(page.getByTestId('home-pinned-empty')).toBeVisible()

  await invoke(page, 'pins:pin', { repoId: demo.id })
  const pinned = page.getByTestId(`home-pinned-${demo.id}`)
  await expect(pinned).toBeVisible()
  await expect(pinned).toContainText(demo.fullName.split('/')[1] as string)

  await page.getByTestId(`home-pinned-${demo.id}-unpin`).click()
  await expect(pinned).toHaveCount(0)
  await expect(page.getByTestId('home-pinned-empty')).toBeVisible()
  expect(await invoke(page, 'pins:list')).toEqual([])
})

test('고정 카드를 누르면 저장소 상세로 간다', async ({ page }) => {
  const demo = FIXTURE.repos.demo
  await openHomeAfterSync(page)
  await invoke(page, 'pins:pin', { repoId: demo.id })
  await page
    .getByTestId(`home-pinned-${demo.id}`)
    .getByRole('button', { name: demo.fullName, exact: true })
    .click()
  await expect
    .poll(() =>
      page.evaluate(() => (globalThis as unknown as { location: { hash: string } }).location.hash)
    )
    .toBe(`#/repos/${demo.id}`)
})
