import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './support/fixtures'
import { invoke, waitForAppShell } from './support/helpers'

// 설정 화면(spec §4.13): 언어·테마(바로 적용, 다시 켜도 유지), 홈 카드, 클론 주소, 연결된 폴더, 정보.

const SYNC_TIMEOUT = 20_000

async function goto(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    // 노드 설정(tsconfig.node)에는 DOM 타입이 없다
    ;(globalThis as unknown as { location: { hash: string } }).location.hash = `#${p}`
  }, path)
}

async function openSettings(page: Page): Promise<void> {
  await waitForAppShell(page)
  await goto(page, '/settings')
  await expect(page.getByTestId('settings-page')).toBeVisible()
}

function htmlAttr(page: Page, name: 'lang' | 'data-theme') {
  return page.locator('html').getAttribute(name)
}

const inboxNav = (page: Page) => page.locator('[data-nav="inbox"]')

test('언어·테마를 바꾸면 바로 적용된다', async ({ page }) => {
  await openSettings(page)

  await page.getByTestId('settings-language-en').click()
  await expect(inboxNav(page)).toContainText('Inbox')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByTestId('settings-language-ko').click()
  await expect(inboxNav(page)).toContainText('알림함')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko')

  await page.getByTestId('settings-theme-dark').click()
  await expect.poll(() => htmlAttr(page, 'data-theme')).toBe('dark')
  await page.getByTestId('settings-theme-light').click()
  await expect.poll(() => htmlAttr(page, 'data-theme')).toBe('light')

  const saved = await invoke(page, 'settings:get')
  expect(saved.language).toBe('ko')
  expect(saved.theme).toBe('light')
})

test('언어·테마는 다시 켜도 유지된다', async ({ launchGdesk }) => {
  const first = await launchGdesk()
  await openSettings(first.page)
  await first.page.getByTestId('settings-language-ko').click()
  await first.page.getByTestId('settings-theme-light').click()
  await expect.poll(() => htmlAttr(first.page, 'data-theme')).toBe('light')
  await expect
    .poll(async () => {
      const saved = await invoke(first.page, 'settings:get')
      return [saved.language, saved.theme]
    })
    .toEqual(['ko', 'light'])
  await first.app.close()

  const second = await launchGdesk({ userDataDir: first.userDataDir })
  await waitForAppShell(second.page)
  await expect(second.page.locator('html')).toHaveAttribute('lang', 'ko')
  await expect(second.page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(inboxNav(second.page)).toContainText('알림함')

  // 다시 켠 뒤에도 설정 화면이 저장된 값을 고른 상태로 보인다
  await goto(second.page, '/settings')
  await expect(second.page.getByTestId('settings-theme-light')).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await expect(second.page.getByTestId('settings-language-ko')).toHaveAttribute(
    'aria-checked',
    'true'
  )
})

test('홈 카드: 실패한 CI 를 끄고 스타 변화를 맨 위로 올리면 홈에 반영된다', async ({ page }) => {
  await openSettings(page)
  const rows = page.getByTestId('settings-home-cards').locator('li')
  await expect(rows).toHaveCount(10)
  await page.getByTestId('settings-card-failedCi-toggle').click()
  await expect(page.getByTestId('settings-card-failedCi')).toHaveAttribute('data-enabled', 'false')
  const up = page.getByTestId('settings-card-starChanges-up')
  for (let i = 0; i < 9; i++) await up.click()
  await expect(up).toBeDisabled()
  await expect(rows.first()).toHaveAttribute('data-testid', 'settings-card-starChanges')

  await expect
    .poll(async () => (await invoke(page, 'settings:get')).homeCards)
    .toEqual([
      { id: 'starChanges', enabled: true },
      { id: 'stats', enabled: true },
      { id: 'pinnedRepos', enabled: true },
      { id: 'contributions', enabled: true },
      { id: 'recentCommits', enabled: true },
      { id: 'myPullRequests', enabled: true },
      { id: 'reviewRequests', enabled: true },
      { id: 'unreadNotifications', enabled: true },
      { id: 'failedCi', enabled: false },
      { id: 'unanswered', enabled: true }
    ])

  await goto(page, '/home')
  await expect(page.getByTestId('home-card-starChanges')).toBeVisible({ timeout: SYNC_TIMEOUT })
  await expect(page.getByTestId('home-card-failedCi')).toHaveCount(0)
  const cards = page.getByTestId(/^home-card-[A-Za-z]+$/)
  await expect(cards).toHaveCount(9)
  await expect(cards.first()).toHaveAttribute('data-testid', 'home-card-starChanges')
})

test('홈 카드: 새 영역(최근 커밋)을 끄면 홈에서 사라진다', async ({ page }) => {
  await openSettings(page)
  await page.getByTestId('settings-card-recentCommits-toggle').click()
  await expect(page.getByTestId('settings-card-recentCommits')).toHaveAttribute(
    'data-enabled',
    'false'
  )
  await goto(page, '/home')
  await expect(page.getByTestId('home-card-myPullRequests')).toBeVisible({
    timeout: SYNC_TIMEOUT
  })
  await expect(page.getByTestId('home-card-recentCommits')).toHaveCount(0)
})

test('홈의 카드 설정 버튼은 홈 카드 항목으로 간다', async ({ page }) => {
  await waitForAppShell(page)
  await invoke(page, 'settings:update', { language: 'en' })
  await goto(page, '/home')
  await page.getByTestId('top-bar').getByRole('button', { name: 'Customize' }).click()
  await expect(page.getByTestId('settings-page')).toBeVisible()
  await expect(page.getByTestId('settings-section-home-cards')).toBeInViewport()
})

test('클론 주소를 SSH 로 바꾸면 저장된다', async ({ page }) => {
  await openSettings(page)
  await expect(page.getByTestId('settings-protocol-https')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('settings-protocol-ssh').click()
  await expect(page.getByTestId('settings-protocol-ssh')).toHaveAttribute('aria-checked', 'true')
  await expect.poll(async () => (await invoke(page, 'settings:get')).cloneProtocol).toBe('ssh')
})

test('연결된 폴더: 목록에 보이고, 연결 해제해도 폴더는 남는다', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'gdesk-e2e-link-'))
  try {
    execFileSync('git', ['init', '-q', dir])
    execFileSync('git', [
      '-C',
      dir,
      'remote',
      'add',
      'origin',
      'https://github.com/octo-maintainer/gdesk-demo.git'
    ])

    await waitForAppShell(page)
    const outcome = await invoke(page, 'local:link', { repoId: 101, path: dir })
    if (!outcome.ok) throw new Error(`link failed: ${outcome.reason}`)
    const link = outcome.links[0]
    if (!link) throw new Error('no link returned')

    await goto(page, '/settings#folders')
    const row = page.getByTestId(`settings-link-${link.id}`)
    await expect(row).toBeVisible()
    await expect(row.getByTestId('settings-link-path')).toHaveText(link.path)
    await expect(row.getByTestId('settings-link-repo')).toHaveText('octo-maintainer/gdesk-demo', {
      timeout: SYNC_TIMEOUT
    })

    await page.getByTestId(`settings-link-${link.id}-unlink`).click()
    const confirm = page.getByTestId('settings-unlink-confirm')
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText(link.path)
    await page.getByTestId('settings-unlink-confirm-button').click()
    await expect(row).toHaveCount(0)

    const links = await invoke(page, 'local:listLinks', {})
    expect(links.some((l) => l.id === link.id)).toBe(false)
    // 연결만 지우고 폴더는 그대로다
    expect(existsSync(dir)).toBe(true)
    expect(existsSync(join(dir, '.git'))).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('연결된 폴더: 저장소에 접근할 수 없게 되면 사용할 수 없음 표시, 연결은 남고 해제할 수 있다', async ({
  page,
  server
}) => {
  const dotfiles = 102
  const dir = await mkdtemp(join(tmpdir(), 'gdesk-e2e-link-gone-'))
  try {
    execFileSync('git', ['init', '-q', dir])
    execFileSync('git', [
      '-C',
      dir,
      'remote',
      'add',
      'origin',
      'https://github.com/octo-maintainer/dotfiles.git'
    ])

    await waitForAppShell(page)
    // 내 저장소 집합을 받은 뒤에 연결한다(고정하지 않은 저장소)
    await expect
      .poll(
        async () =>
          (await invoke(page, 'query:repositories', {})).items.some((r) => r.id === dotfiles),
        { timeout: SYNC_TIMEOUT }
      )
      .toBe(true)
    const outcome = await invoke(page, 'local:link', { repoId: dotfiles, path: dir })
    if (!outcome.ok) throw new Error(`link failed: ${outcome.reason}`)
    const link = outcome.links[0]
    if (!link) throw new Error('no link returned')
    expect(await invoke(page, 'pins:list')).toEqual([])

    await goto(page, '/settings#folders')
    const row = page.getByTestId(`settings-link-${link.id}`)
    await expect(row).toHaveAttribute('data-access', 'available')
    await expect(row.getByTestId('settings-link-unavailable')).toHaveCount(0)

    server.removeRepo(dotfiles)
    await invoke(page, 'sync:refresh', { scope: 'repositories' })
    await expect(row.getByTestId('settings-link-unavailable')).toBeVisible({
      timeout: SYNC_TIMEOUT
    })
    await expect(row).toHaveAttribute('data-access', 'unavailable')
    // 이름은 캐시에 남은 값으로 보이고, 연결은 자동으로 지우지 않는다
    await expect(row.getByTestId('settings-link-repo')).toHaveText('octo-maintainer/dotfiles')
    expect(server.hasRequest(`GET /repositories/${dotfiles}`)).toBe(true)
    const links = await invoke(page, 'local:listLinks', {})
    expect(links.find((l) => l.id === link.id)?.accessStatus).toBe('unavailable')

    // 해제 버튼으로 지울 수 있다(폴더는 남는다)
    await page.getByTestId(`settings-link-${link.id}-unlink`).click()
    await page.getByTestId('settings-unlink-confirm-button').click()
    await expect(row).toHaveCount(0)
    expect(existsSync(join(dir, '.git'))).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('정보: 버전과 업데이트 꺼짐 상태를 보인다', async ({ page }) => {
  await openSettings(page)
  await invoke(page, 'settings:update', { language: 'en' })
  await expect(inboxNav(page)).toContainText('Inbox')
  const info = await invoke(page, 'app:info')
  await expect(page.getByTestId('settings-app-version')).toContainText(info.version)
  const status = page.getByTestId('settings-updater-status')
  await expect(status).toHaveAttribute('data-state', 'disabled')
  await expect(status).toHaveText('Updates are off in development and test runs')
  await expect(page.getByTestId('settings-updater-check')).toBeDisabled()
})
