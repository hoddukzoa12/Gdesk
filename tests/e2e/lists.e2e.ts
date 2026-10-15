import type { Page } from '@playwright/test'
import { FIXTURE } from '../fixtures/github'
import { expect, test } from './support/fixtures'
import { openedExternalUrls, waitForAppShell } from './support/helpers'

// Pull requests · Review requests · Issues 화면 (spec §4.4–4.6)

const DEMO = FIXTURE.repos.demo.fullName
const ORG = FIXTURE.repos.orgWrite.fullName
const UPSTREAM = FIXTURE.repos.starredOther.fullName

const prRow = (page: Page, repo: string, n: number) => page.getByTestId(`pr-row-${repo}#${n}`)
const issueRow = (page: Page, repo: string, n: number) => page.getByTestId(`issue-row-${repo}#${n}`)

async function openNav(page: Page, id: 'pulls' | 'reviews' | 'issues'): Promise<void> {
  await waitForAppShell(page)
  await page.locator(`[data-nav="${id}"]`).click()
  await expect(page.getByTestId(`${id}-page`)).toBeVisible()
}

/** 탭(언어와 무관하게 data-tab 으로 찾는다) */
const tab = (page: Page, id: string) => page.locator(`[role="tab"][data-tab="${id}"]`)

/** 앱 창 주소의 해시 경로(#/pulls?tab=mine) */
function hashOf(page: Page): string {
  return new URL(page.url()).hash
}

async function rowTestIds(page: Page, prefix: string): Promise<string[]> {
  return page
    .locator(`[data-testid^="${prefix}"]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''))
}

test('Pull requests: 들어온 PR 과 내가 올린 PR', async ({ page }) => {
  await openNav(page, 'pulls')

  // 들어온 PR: 101 의 #42 #41 #40 #39, 내가 올린 301#77 은 없다
  await expect(prRow(page, DEMO, 42)).toBeVisible({ timeout: 20_000 })
  await expect(prRow(page, DEMO, 41)).toBeVisible()
  const pr40 = prRow(page, DEMO, 40)
  await expect(pr40).toBeVisible()
  await expect(pr40.locator('[data-status="failing"]')).toBeVisible()
  await expect(pr40.locator('[data-review="changes_requested"]')).toBeVisible()
  const pr39 = prRow(page, DEMO, 39)
  await expect(pr39).toBeVisible()
  await expect(pr39.locator('[data-draft]')).toBeVisible()
  await expect(prRow(page, UPSTREAM, 77)).toHaveCount(0)
  await expect(tab(page, 'incoming')).toHaveAttribute('aria-selected', 'true')

  // 내가 올린 PR 탭: 주소에 ?tab=mine 이 남는다
  await tab(page, 'mine').click()
  await expect(prRow(page, UPSTREAM, 77)).toBeVisible()
  await expect(prRow(page, UPSTREAM, 78)).toBeVisible()
  await expect(prRow(page, UPSTREAM, 78).locator('[data-review="approved"]')).toBeVisible()
  await expect(prRow(page, DEMO, 42)).toHaveCount(0)
  expect(hashOf(page)).toBe('#/pulls?tab=mine')

  // 새로 고침해도 같은 탭
  await page.reload()
  await expect(prRow(page, UPSTREAM, 77)).toBeVisible({ timeout: 20_000 })
  await expect(tab(page, 'mine')).toHaveAttribute('aria-selected', 'true')

  // 뒤로 가면 들어온 PR 탭
  await tab(page, 'incoming').click()
  await expect(prRow(page, DEMO, 42)).toBeVisible()
  await page.goBack()
  await expect(prRow(page, UPSTREAM, 77)).toBeVisible()
})

test('Review requests: 나·내 팀에게 요청된 PR 3개', async ({ page }) => {
  await openNav(page, 'reviews')
  await expect(prRow(page, ORG, 13)).toBeVisible({ timeout: 20_000 })
  await expect(prRow(page, ORG, 12)).toBeVisible()
  await expect(prRow(page, UPSTREAM, 80)).toBeVisible()
  await expect.poll(() => rowTestIds(page, 'pr-row-')).toHaveLength(3)
  expect((await rowTestIds(page, 'pr-row-')).sort()).toEqual(
    [`pr-row-${ORG}#13`, `pr-row-${ORG}#12`, `pr-row-${UPSTREAM}#80`].sort()
  )
})

test('Issues: 들어온 이슈 · 나에게 할당 · 내가 올린 이슈', async ({ page }) => {
  await openNav(page, 'issues')

  await expect(issueRow(page, DEMO, 45)).toBeVisible({ timeout: 20_000 })
  await expect(issueRow(page, DEMO, 43)).toHaveCount(0)
  // PR 은 섞지 않는다
  await expect(page.locator('[data-testid^="pr-row-"]')).toHaveCount(0)
  await expect(issueRow(page, DEMO, 45).locator('[data-label]').first()).toBeVisible()

  await tab(page, 'assigned').click()
  await expect(issueRow(page, ORG, 8)).toBeVisible()
  await expect(issueRow(page, DEMO, 44)).toBeVisible()
  expect(hashOf(page)).toBe('#/issues?tab=assigned')

  await tab(page, 'mine').click()
  await expect(issueRow(page, DEMO, 43)).toBeVisible()
  await expect(issueRow(page, UPSTREAM, 90)).toBeVisible()
  expect(hashOf(page)).toBe('#/issues?tab=mine')
})

test('행을 누르면 GitHub 페이지를 브라우저로 연다', async ({ app, page, server }) => {
  await openNav(page, 'pulls')
  await prRow(page, DEMO, 42).getByRole('button').click()
  await expect.poll(() => openedExternalUrls(app)).toContain(`${server.webBase}/${DEMO}/pull/42`)

  await page.locator('[data-nav="reviews"]').click()
  await prRow(page, ORG, 13).getByRole('button').click()
  await expect.poll(() => openedExternalUrls(app)).toContain(`${server.webBase}/${ORG}/pull/13`)

  await page.locator('[data-nav="issues"]').click()
  await issueRow(page, DEMO, 45).getByRole('button').click()
  await expect.poll(() => openedExternalUrls(app)).toContain(`${server.webBase}/${DEMO}/issues/45`)

  // 앱 창은 그대로(웹 주소로 이동하지 않는다)
  expect(hashOf(page)).toBe('#/issues')
})
