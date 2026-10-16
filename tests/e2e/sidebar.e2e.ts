import type { Page } from '@playwright/test'
import { expect, test } from './support/fixtures'
import { invoke, waitForAppShell } from './support/helpers'

// 사이드바(로고 · 메뉴 수치 · Pinned · Your repositories · 오프라인 배너), 상단 막대의 동기화 상태·새로고침,
// Repositories 화면, Starred 화면 (spec §4.1, §4.7, §4.8, §6).
// 앱 언어는 OS 언어를 따르므로 문구 대신 data-testid·data 속성으로 확인한다.

const SYNC_TIMEOUT = 20_000

/** 메뉴 항목의 숫자 배지 */
async function navCount(page: Page, id: string): Promise<string> {
  const text = (await page.locator(`[data-nav="${id}"]`).textContent()) ?? ''
  return text.replace(/\D/g, '')
}

async function rowIds(page: Page, prefix: string): Promise<string[]> {
  const ids = await page
    .locator(`[data-testid^="${prefix}"]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''))
  return ids.map((id) => id.slice(prefix.length))
}

async function lastSeq(server: { requests: Array<{ seq: number }> }): Promise<number> {
  return server.requests.reduce((max, r) => Math.max(max, r.seq), 0)
}

test('동기화 뒤 메뉴 수치와 Your repositories', async ({ page }) => {
  await waitForAppShell(page)
  await expect.poll(() => navCount(page, 'inbox'), { timeout: SYNC_TIMEOUT }).toBe('6')
  await expect.poll(() => navCount(page, 'pulls'), { timeout: SYNC_TIMEOUT }).toBe('6')
  await expect.poll(() => navCount(page, 'reviews'), { timeout: SYNC_TIMEOUT }).toBe('3')
  await expect
    .poll(() => page.locator('[data-testid^="your-repo-row-"]').count(), { timeout: SYNC_TIMEOUT })
    .toBe(3)
  // 포크(103)·보관(104)은 빠진다
  const ids = await rowIds(page, 'your-repo-row-')
  expect(ids).not.toContain('103')
  expect(ids).not.toContain('104')
})

test('Repositories: 포크·보관은 기본으로 숨기고 토글로 보인다, 고정·해제', async ({ page }) => {
  await waitForAppShell(page)
  await page.locator('[data-nav="repositories"]').click()
  await expect(page.getByTestId('repositories-page')).toBeVisible()
  await expect(page.getByTestId('repo-row-101')).toBeVisible({ timeout: SYNC_TIMEOUT })
  await expect(page.getByTestId('repo-row-201')).toBeVisible()
  await expect(page.getByTestId('repo-row-103')).toHaveCount(0)
  await expect(page.getByTestId('repo-row-104')).toHaveCount(0)

  await page.getByTestId('repositories-show-forks').check()
  await expect(page.getByTestId('repo-row-103')).toBeVisible()
  await expect(page.getByTestId('repo-row-104')).toHaveCount(0)
  await page.getByTestId('repositories-show-archived').check()
  await expect(page.getByTestId('repo-row-104')).toBeVisible()
  await page.getByTestId('repositories-show-forks').uncheck()
  await expect(page.getByTestId('repo-row-103')).toHaveCount(0)

  // 고정하면 사이드바 Pinned 에 나타나고, 해제하면 사라진다
  const pinned = page.getByTestId('sidebar-pinned')
  await expect(pinned.getByTestId('pinned-row-101')).toHaveCount(0)
  await page.getByTestId('repo-pin-101').click()
  await expect(pinned.getByTestId('pinned-row-101')).toBeVisible()
  await expect(pinned.getByTestId('pinned-row-101')).toContainText('gdesk-demo')
  await expect(page.getByTestId('repo-pin-101')).toHaveAttribute('aria-pressed', 'true')
  expect((await invoke(page, 'pins:list')).map((p) => p.repoId)).toEqual([101])

  await page.getByTestId('repo-pin-101').click()
  await expect(pinned.getByTestId('pinned-row-101')).toHaveCount(0)
  await expect(page.getByTestId('repo-pin-101')).toHaveAttribute('aria-pressed', 'false')
  expect(await invoke(page, 'pins:list')).toEqual([])

  // 저장소 줄을 누르면 상세 화면 주소로 간다
  await page
    .getByTestId('repo-row-101')
    .getByRole('button', { name: 'octo-maintainer/gdesk-demo', exact: true })
    .click()
  await expect.poll(() => new URL(page.url()).hash).toBe('#/repos/101')
})

test('Pinned: 끌어서 순서를 바꾸면 저장된다', async ({ page }) => {
  await waitForAppShell(page)
  await expect
    .poll(() => page.locator('[data-testid^="your-repo-row-"]').count(), { timeout: SYNC_TIMEOUT })
    .toBe(3)
  await invoke(page, 'pins:pin', { repoId: 101 })
  await invoke(page, 'pins:pin', { repoId: 201 })
  await expect.poll(() => rowIds(page, 'pinned-row-')).toEqual(['101', '201'])

  await page.getByTestId('pinned-row-201').dragTo(page.getByTestId('pinned-row-101'))
  await expect.poll(() => rowIds(page, 'pinned-row-')).toEqual(['201', '101'])
  await expect
    .poll(async () => (await invoke(page, 'pins:list')).map((p) => p.repoId))
    .toEqual([201, 101])

  // 키보드: Alt+↓
  await page.getByTestId('pinned-row-201').getByRole('button').first().focus()
  await page.keyboard.press('Alt+ArrowDown')
  await expect
    .poll(async () => (await invoke(page, 'pins:list')).map((p) => p.repoId))
    .toEqual([101, 201])
})

test('Pinned: 삭제·권한 상실로 접근할 수 없게 된 저장소는 사용할 수 없음 표시, 고정은 남는다', async ({
  page,
  server
}) => {
  const dotfiles = 102
  await waitForAppShell(page)
  await expect
    .poll(() => page.locator('[data-testid^="your-repo-row-"]').count(), { timeout: SYNC_TIMEOUT })
    .toBe(3)
  await invoke(page, 'pins:pin', { repoId: dotfiles })
  const row = page.getByTestId(`pinned-row-${dotfiles}`)
  await expect(row).toContainText('dotfiles', { timeout: SYNC_TIMEOUT })
  await expect(page.getByTestId(`pinned-unavailable-${dotfiles}`)).toHaveCount(0)

  // 저장소가 지워진다: 내 저장소 집합에서 빠지고 GET /repositories/102 는 404
  server.removeRepo(dotfiles)
  await invoke(page, 'sync:refresh', { scope: 'repositories' })
  await expect(page.getByTestId(`pinned-unavailable-${dotfiles}`)).toBeVisible({
    timeout: SYNC_TIMEOUT
  })
  await expect(row).toHaveAttribute('data-access', 'unavailable')
  // 빠진 고정 저장소는 접근 여부를 직접 확인한다
  expect(server.hasRequest(`GET /repositories/${dotfiles}`)).toBe(true)
  // 자동으로 지우지 않는다
  expect((await invoke(page, 'pins:list')).map((p) => p.repoId)).toEqual([dotfiles])
})

test('Starred: 스타한 시각 최신순, 누르면 저장소 상세 주소', async ({ page }) => {
  await waitForAppShell(page)
  await page.locator('[data-nav="starred"]').click()
  await expect(page.getByTestId('starred-page')).toBeVisible()
  await expect
    .poll(() => rowIds(page, 'starred-row-'), { timeout: SYNC_TIMEOUT })
    .toEqual(['302', '301', '101'])

  await page.getByTestId('starred-search').fill('tiny')
  await expect.poll(() => rowIds(page, 'starred-row-')).toEqual(['302'])
  await page.getByTestId('starred-search').fill('')
  await expect.poll(() => rowIds(page, 'starred-row-')).toEqual(['302', '301', '101'])

  await page
    .getByTestId('starred-row-301')
    .getByRole('button', { name: 'upstream-org/awesome-lib' })
    .click()
  await expect.poll(() => new URL(page.url()).hash).toBe('#/repos/301')
})

test('사이드바 맨 위에 Gdesk 로고, 동기화 상태는 사이드바가 아니라 상단 막대에', async ({
  page
}) => {
  await waitForAppShell(page)
  const sidebar = page.getByTestId('sidebar')
  await expect(sidebar.getByTestId('app-logo')).toHaveText('Gdesk')
  await expect(sidebar.getByTestId('app-logo').locator('svg')).toBeVisible()
  await expect(sidebar.getByTestId('sync-footer')).toHaveCount(0)

  const topBar = page.getByTestId('top-bar')
  await expect(topBar.getByTestId('sync-footer-text')).toHaveText(/^Synced |동기화됨$/, {
    timeout: SYNC_TIMEOUT
  })
  await expect(topBar.getByTestId('sync-refresh')).toBeVisible()
  // 오른쪽 순서: 동기화 문구 → 새로고침 → 검색 입력
  const x = async (id: string) => (await topBar.getByTestId(id).boundingBox())!.x
  expect(await x('sync-footer-text')).toBeLessThan(await x('sync-refresh'))
  expect(await x('sync-refresh')).toBeLessThan(await x('palette-open-button'))
})

test('오프라인이면 배너와 상단 막대 문구, 연결이 돌아오면 회복', async ({ page, server }) => {
  await waitForAppShell(page)
  const footer = page.getByTestId('top-bar').getByTestId('sync-footer')
  await expect.poll(() => navCount(page, 'inbox'), { timeout: SYNC_TIMEOUT }).toBe('6')
  await expect(footer).toHaveAttribute('data-connection', 'online')
  await expect(page.getByTestId('offline-banner')).toHaveCount(0)

  server.goOffline()
  await invoke(page, 'sync:refresh', { scope: 'home' }).catch(() => undefined)
  await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: SYNC_TIMEOUT })
  await expect(footer).toHaveAttribute('data-connection', 'offline')
  await expect(page.getByTestId('sync-footer-text')).toHaveText(/^(Offline|오프라인) · /)

  server.goOnline()
  await expect
    .poll(
      async () => {
        await invoke(page, 'sync:refresh', { scope: 'home' }).catch(() => undefined)
        return footer.getAttribute('data-connection')
      },
      { timeout: SYNC_TIMEOUT }
    )
    .toBe('online')
  await expect(page.getByTestId('offline-banner')).toHaveCount(0)
  await expect(page.getByTestId('sync-footer-text')).toHaveText(/^Synced |동기화됨$/)
})

test('상단 막대의 새로고침 버튼과 단축키는 지금 화면 범위로 가짜 서버에 요청한다', async ({
  page,
  server
}) => {
  await waitForAppShell(page)
  await page.locator('[data-nav="starred"]').click()
  await expect
    .poll(() => rowIds(page, 'starred-row-'), { timeout: SYNC_TIMEOUT })
    .toEqual(['302', '301', '101'])

  const starredAfter = (seq: number) => (r: { seq: number; key: string }) =>
    r.seq > seq && r.key === 'GRAPHQL GdeskStarredRepositories'

  let before = await lastSeq(server)
  await page.getByTestId('top-bar').getByTestId('sync-refresh').click()
  await server.waitForRequest(starredAfter(before), 10_000)

  // ⌘R / Ctrl+R: 창을 다시 읽지 않고 같은 새로고침을 한다
  await page.evaluate(() => {
    ;(globalThis as unknown as { __gdeskMarker?: number }).__gdeskMarker = 1
  })
  before = await lastSeq(server)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+R' : 'Control+R')
  await server.waitForRequest(starredAfter(before), 10_000)
  expect(
    await page.evaluate(() => (globalThis as unknown as { __gdeskMarker?: number }).__gdeskMarker)
  ).toBe(1)
})
