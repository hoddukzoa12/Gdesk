import { existsSync, realpathSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './support/fixtures'
import { invoke, waitForAppShell } from './support/helpers'

// 클론·열기(spec §4.9 메뉴, §4.10, §4.11). 가짜 GitHub 의 git 저장소 octo-maintainer/gdesk-demo(101)에서
// 임시 클론 기본 폴더로 클론한다. 편집기·터미널·파일 관리자 실행은 테스트 모드에서 기록만 된다.
// 화면 언어는 OS 를 따르므로 문구 대신 data-* 속성과 testid 로 확인한다.

const SYNC_TIMEOUT = 20_000
const CLONE_TIMEOUT = 30_000

test.use({ serverOptions: { gitRepos: ['octo-maintainer/gdesk-demo'] } })

let baseDir: string | null = null

test.afterEach(async () => {
  if (baseDir) await rm(baseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  baseDir = null
})

/** 임시 클론 기본 폴더를 설정하고 저장소 101 화면을 연다. 실제 경로(realpath)를 돌려준다 */
async function setup(page: Page): Promise<string> {
  await waitForAppShell(page)
  baseDir = await mkdtemp(join(tmpdir(), 'gdesk-clone-'))
  await invoke(page, 'settings:update', { cloneBaseDir: baseDir })
  await page.evaluate(() => {
    ;(globalThis as unknown as { location: { hash: string } }).location.hash = '#/repos/101'
  })
  await expect(page.getByTestId('repo-detail-page')).toHaveAttribute('data-state', 'ready', {
    timeout: SYNC_TIMEOUT
  })
  return realpathSync(baseDir)
}

async function openMenu(page: Page): Promise<void> {
  await page.getByTestId('repo-clone-button').click()
  await expect(page.getByTestId('clone-menu')).toBeVisible()
}

async function startClone(page: Page): Promise<void> {
  await openMenu(page)
  await page.getByTestId('clone-menu-clone').click()
  const dialog = page.getByTestId('clone-dialog')
  await expect(dialog).toBeVisible()
  const start = page.getByTestId('clone-start')
  await expect(start).toBeEnabled({ timeout: SYNC_TIMEOUT })
  await start.click()
}

test('클론하면 폴더가 생기고 Open 이 되며, 터미널·Finder 로 열고, 다시 클론하면 이 폴더 연결을 제안한다', async ({
  page
}) => {
  const base = await setup(page)
  const button = page.getByTestId('repo-clone-button')
  await expect(button).toHaveAttribute('data-mode', 'clone')

  // 1. Clone… → 시작 → 성공
  await startClone(page)
  const success = page.getByTestId('clone-success')
  await expect(success).toBeVisible({ timeout: CLONE_TIMEOUT })
  await expect(page.getByTestId('clone-dialog')).toHaveAttribute('data-state-kind', 'cloned')
  await expect(page.getByTestId('clone-open-editor')).toBeVisible()
  const cloned = join(base, 'gdesk-demo')
  expect(existsSync(join(cloned, '.git'))).toBe(true)
  await page.getByTestId('clone-close').click()
  await expect(page.getByTestId('clone-dialog')).toHaveCount(0)
  await expect(button).toHaveAttribute('data-mode', 'open')

  // 2. Open → 터미널, Finder 에서 보기(기록만 된다)
  await openMenu(page)
  await page.getByTestId('clone-menu-open-terminal').click()
  await expect
    .poll(async () => (await invoke(page, 'local:testLaunches')).filter((l) => l.kind === 'spawn'))
    .toHaveLength(1)
  await openMenu(page)
  await page.getByTestId('clone-menu-show-folder').click()
  await expect
    .poll(async () =>
      (await invoke(page, 'local:testLaunches'))
        .filter((l) => l.kind === 'openPath')
        .map((l) => l.path)
    )
    .toEqual([cloned])
  await expect(page.getByTestId('clone-menu-message')).toHaveCount(0)

  // 3. 같은 곳에 다시 클론 → 이미 있음(같은 저장소) → 이 폴더 연결
  await startClone(page)
  const exists = page.getByTestId('clone-exists')
  await expect(exists).toBeVisible({ timeout: CLONE_TIMEOUT })
  await expect(exists).toHaveAttribute('data-same-repo', 'true')
  const linkButton = page.getByTestId('clone-link-folder')
  await expect(linkButton).toBeVisible()
  await linkButton.click()
  await expect(page.getByTestId('clone-dialog')).toHaveAttribute('data-state-kind', 'linked')
  await expect(page.getByTestId('clone-success')).toHaveAttribute('data-path', cloned)
})

test('오프라인이면 클론 시작 버튼이 꺼진다', async ({ page, server }) => {
  await setup(page)
  server.goOffline()
  await invoke(page, 'sync:refresh', { scope: 'repo:101' }).catch(() => undefined)

  await openMenu(page)
  await page.getByTestId('clone-menu-clone').click()
  await expect(page.getByTestId('clone-dialog')).toBeVisible()
  await expect(page.getByTestId('clone-start')).toBeDisabled({ timeout: SYNC_TIMEOUT })
  await expect(page.getByTestId('clone-blocked-reason')).toBeVisible()
})

test('HTTPS·SSH 주소를 복사한다', async ({ app, page }) => {
  await setup(page)
  // 화면은 navigator.clipboard 로 시스템 클립보드에 쓴다. 메인 프로세스의 clipboard 로 읽어 확인한다
  await app.evaluate(({ clipboard }) => clipboard.writeText(''))

  await openMenu(page)
  await page.getByTestId('clone-menu-copy-https').click()
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('https://github.com/octo-maintainer/gdesk-demo.git')
  await expect(page.getByTestId('clone-menu-message')).toHaveAttribute('data-kind', 'info')

  await openMenu(page)
  await page.getByTestId('clone-menu-copy-ssh').click()
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('git@github.com:octo-maintainer/gdesk-demo.git')
})
