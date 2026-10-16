import type { Page } from '@playwright/test'
import { FIXTURE } from '../fixtures/github'
import { expect, test } from './support/fixtures'
import { invoke, openedExternalUrls, waitForAppShell } from './support/helpers'

// 빠른 검색창(⌘K / Ctrl+K, spec §4.12): 앱 안 항목·명령·GitHub 저장소 검색.
// 앱 언어는 OS 언어를 따르므로 문구 대신 data-testid·data 속성과 영어 명령 낱말로 확인한다.

const SYNC_TIMEOUT = 20_000
const SHORTCUT = process.platform === 'darwin' ? 'Meta+K' : 'Control+K'
const R = FIXTURE.repos

/** 첫 동기화가 끝나 캐시에 저장소가 들어올 때까지 기다린다 */
async function waitForSync(page: Page): Promise<void> {
  await waitForAppShell(page)
  await expect
    .poll(async () => (await invoke(page, 'search:local', { text: 'gdesk-demo' })).repositories, {
      timeout: SYNC_TIMEOUT
    })
    .toHaveLength(1)
}

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press(SHORTCUT)
  await expect(page.getByTestId('palette')).toBeVisible()
  await expect(page.getByTestId('palette-input')).toBeFocused()
}

function hash(page: Page): Promise<string> {
  return page.evaluate(
    () => (globalThis as unknown as { location: { hash: string } }).location.hash
  )
}

test('상단 막대 맨 오른쪽 검색 입력을 누르면 빠른 검색창이 열린다', async ({ page }) => {
  await waitForAppShell(page)
  // 테스트 창(1280px)은 접히는 너비(1100px)보다 넓어 입력 모양이다
  const trigger = page.getByTestId('top-bar').getByTestId('palette-open-button')
  await expect(trigger).toHaveAttribute('data-collapsed', 'false')
  await expect(trigger).toContainText(
    /Search repositories, issues, pull requests…|저장소, 이슈, PR 검색…/
  )
  await trigger.click()
  await expect(page.getByTestId('palette')).toBeVisible()
  await expect(page.getByTestId('palette-input')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette')).toHaveCount(0)
})

test('저장소를 찾아 Enter 로 상세 화면에 간다, Esc 로 닫는다', async ({ page }) => {
  await waitForSync(page)
  await openPalette(page)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette')).toHaveCount(0)

  await openPalette(page)
  await page.getByTestId('palette-input').fill('gdesk-demo')
  const item = page.getByTestId(`palette-item-repo-${R.demo.id}`)
  await expect(item).toBeVisible()
  // 저장소 구역이 맨 앞이라 첫 항목이 골라져 있다
  await expect(item).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('palette')).toHaveCount(0)
  await expect.poll(() => hash(page)).toBe(`#/repos/${R.demo.id}`)
  await expect(page.getByTestId('repo-detail-page')).toBeVisible()
  await expect(page.getByTestId('repo-name')).toHaveText('gdesk-demo', { timeout: SYNC_TIMEOUT })
})

test('#번호로 PR 을 찾아 Enter 로 브라우저에서 연다', async ({ app, page, server }) => {
  await waitForSync(page)
  await openPalette(page)
  await page.getByTestId('palette-input').fill('#42')
  const pr = page.locator('[data-testid^="palette-item-pr-"]', { hasText: '#42' })
  await expect(pr).toHaveCount(1)
  await expect(pr).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect
    .poll(() => openedExternalUrls(app))
    .toEqual([`${server.webBase}/octo-maintainer/gdesk-demo/pull/42`])
  await expect(page.getByTestId('palette')).toHaveCount(0)
})

test('명령: Inbox 로 가기, 테마 어둡게·밝게', async ({ page }) => {
  await waitForAppShell(page)
  await openPalette(page)
  await page.getByTestId('palette-input').fill('inbox')
  await expect(page.locator('[data-testid^="palette-item-"]')).toHaveCount(1)
  await page.getByTestId('palette-item-command-go-inbox').click()
  await expect.poll(() => hash(page)).toBe('#/inbox')

  await openPalette(page)
  await page.getByTestId('palette-input').fill('theme')
  // ↓ 로 옮긴 뒤(밝게) ↑ 로 되돌아와(어둡게) Enter
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('palette-item-command-theme-light')).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await openPalette(page)
  await page.getByTestId('palette-input').fill('dark')
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect.poll(async () => (await invoke(page, 'settings:get')).theme).toBe('dark')
})

test('GitHub 검색: 결과를 누르면 앱 안 상세 화면이 열린다', async ({ page, server }) => {
  await waitForSync(page)
  await openPalette(page)
  await page.getByTestId('palette-input').fill('awesome')
  const hit = page.getByTestId(`palette-item-github-${R.starredOther.id}`)
  await expect(hit).toBeVisible({ timeout: SYNC_TIMEOUT })
  expect(server.hasRequest('GET /search/repositories')).toBe(true)
  await hit.click()
  await expect.poll(() => hash(page)).toBe(`#/repos/${R.starredOther.id}`)
  await expect(page.getByTestId('repo-name')).toHaveText('awesome-lib', { timeout: SYNC_TIMEOUT })
})

test('GitHub 검색: 캐시에 없는 저장소도 숫자 ID 로 받아 상세를 연다', async ({ page, server }) => {
  await waitForSync(page)
  // 202(READ, 스타 안 함)는 내 저장소 집합에서 빠져 캐시에 없다
  expect(await invoke(page, 'query:repoDetail', { repoId: R.orgRead.id })).toBeNull()
  await openPalette(page)
  await page.getByTestId('palette-input').fill('website')
  const hit = page.getByTestId(`palette-item-github-${R.orgRead.id}`)
  await expect(hit).toBeVisible({ timeout: SYNC_TIMEOUT })
  await hit.click()
  await expect.poll(() => hash(page)).toBe(`#/repos/${R.orgRead.id}`)
  await expect(page.getByTestId('repo-detail-page')).toHaveAttribute('data-state', 'ready', {
    timeout: SYNC_TIMEOUT
  })
  await expect(page.getByTestId('repo-name')).toHaveText('website')
  expect(server.hasRequest(`GET /repositories/${R.orgRead.id}`)).toBe(true)
})

test('오프라인: 앱 안 검색은 되고 GitHub 구역은 오프라인 안내', async ({ page, server }) => {
  await waitForSync(page)
  server.goOffline()
  await invoke(page, 'sync:refresh', { scope: 'home' }).catch(() => undefined)
  await expect
    .poll(async () => (await invoke(page, 'sync:getStatus')).connection, {
      timeout: SYNC_TIMEOUT
    })
    .toBe('offline')
  const before = server.requests.length

  await openPalette(page)
  await page.getByTestId('palette-input').fill('gdesk-demo')
  await expect(page.getByTestId(`palette-item-repo-${R.demo.id}`)).toBeVisible()
  await expect(page.getByTestId('palette-note-github')).toHaveAttribute('data-note', 'offline')
  await expect(page.locator('[data-testid^="palette-item-github-"]')).toHaveCount(0)
  expect(server.requests.slice(before).some((r) => r.path.startsWith('/search/'))).toBe(false)
})
