import type { Page } from '@playwright/test'
import { FIXTURE } from '../fixtures/github'
import { expect, test } from './support/fixtures'
import { invoke, openedExternalUrls, waitForAppShell } from './support/helpers'

// 로그인 화면·세션 UI (T11). 문구는 OS 언어에 따라 바뀌므로 data-testid 로 찾는다.

async function loginWithToken(page: Page, token: string): Promise<void> {
  const input = page.getByTestId('token-input')
  await input.fill(token)
  await page.getByTestId('token-submit').click()
}

async function expectSignedInShell(page: Page): Promise<void> {
  await expect(page.getByTestId('login-screen')).toBeHidden({ timeout: 20_000 })
  await waitForAppShell(page)
  await expect(page.getByTestId('account-login')).toHaveText(FIXTURE.viewer.login)
}

test.describe('로그아웃 상태로 시작', () => {
  test.use({ token: null })

  test('로그인 화면이 보이고, 토큰으로 로그인하면 앱 틀과 계정 이름이 보인다', async ({ page }) => {
    await expect(page.getByTestId('login-screen')).toBeVisible({ timeout: 20_000 })
    const input = page.getByTestId('token-input')
    await expect(input).toHaveAttribute('type', 'password')

    await loginWithToken(page, FIXTURE.token)
    await expectSignedInShell(page)
    const session = await invoke(page, 'auth:getSession')
    expect(session.state).toBe('signed_in')
    // 권한이 다 있으면 안내 배너는 없다
    await expect(page.getByTestId('token-warning-banner')).toHaveCount(0)
    // 처음 로그인한 뒤 Home 카드가 보인다(spec §13-1)
    await expect(page.getByTestId('home-card-reviewRequests')).toBeVisible({ timeout: 20_000 })
  })

  test('잘못된 토큰은 입력란 아래에 오류를 보여 주고 입력을 비운다', async ({ page }) => {
    await expect(page.getByTestId('login-screen')).toBeVisible({ timeout: 20_000 })
    await loginWithToken(page, FIXTURE.invalidToken)
    await expect(page.getByTestId('token-error')).toBeVisible()
    await expect(page.getByTestId('token-input')).toHaveValue('')
    await expect(page.getByTestId('login-screen')).toBeVisible()
    expect((await invoke(page, 'auth:getSession')).state).toBe('signed_out')
  })

  test('세분화 토큰으로 로그인하면 Inbox 사용 불가 배너', async ({ page, server }) => {
    await expect(page.getByTestId('login-screen')).toBeVisible({ timeout: 20_000 })
    server.setFineGrained(true)
    await loginWithToken(page, FIXTURE.token)
    await expectSignedInShell(page)
    expect((await invoke(page, 'auth:getSession')).tokenKind).toBe('fine_grained')
    const banner = page.getByTestId('token-warning-banner')
    await expect(banner).toBeVisible()
    // 닫으면 사라진다
    await banner.getByRole('button').last().click()
    await expect(banner).toHaveCount(0)
  })

  test('브라우저 코드 로그인: 코드 GDSK-1234 를 보여 주고 승인되면 로그인된다', async ({
    app,
    page,
    server
  }) => {
    await expect(page.getByTestId('login-screen')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('device-flow-start').click()
    await expect(page.getByTestId('device-user-code')).toHaveText(FIXTURE.deviceUserCode)

    await page.getByTestId('device-flow-open').click()
    await expect.poll(() => openedExternalUrls(app)).toContain(`${server.webBase}/login/device`)

    server.setDeviceFlowOutcome('approve')
    await expectSignedInShell(page)
    expect((await invoke(page, 'auth:getSession')).tokenKind).toBe('oauth')
  })

  test('브라우저 코드 로그인 거부 → 다시 시도할 수 있다', async ({ page, server }) => {
    await expect(page.getByTestId('login-screen')).toBeVisible({ timeout: 20_000 })
    server.setDeviceFlowOutcome('deny')
    await page.getByTestId('device-flow-start').click()
    await expect(page.getByTestId('device-flow-status')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('device-flow-retry')).toBeEnabled()
  })
})

test('세분화 토큰으로 시작(서버 설정 후 실행)해도 Inbox 사용 불가 배너', async ({
  server,
  launchGdesk
}) => {
  server.setFineGrained(true)
  const { page } = await launchGdesk()
  await expectSignedInShell(page)
  await expect(page.getByTestId('token-warning-banner')).toBeVisible()
})

test('로그인 중 401 → 세션 만료 배너, 다시 로그인을 누르면 로그인 화면', async ({
  page,
  server
}) => {
  await expectSignedInShell(page)
  await expect(page.getByTestId('session-expired-banner')).toHaveCount(0)

  server.setUnauthorized(true)
  await invoke(page, 'sync:refresh', { scope: 'home' }).catch(() => undefined)
  const banner = page.getByTestId('session-expired-banner')
  await expect(banner).toBeVisible({ timeout: 15_000 })
  // 만료만으로는 로그아웃하지 않는다(저장된 정보는 읽기 전용으로 계속 보인다)
  await expect(page.getByTestId('login-screen')).toHaveCount(0)
  expect((await invoke(page, 'auth:getSession')).state).toBe('expired')

  await banner.getByRole('button').click()
  await expect(page.getByTestId('login-screen')).toBeVisible()

  server.setUnauthorized(false)
  await loginWithToken(page, FIXTURE.token)
  await expectSignedInShell(page)
  await expect(page.getByTestId('session-expired-banner')).toHaveCount(0)
})

test('계정 메뉴에서 로그아웃하면 확인 후 로그인 화면', async ({ app, page }) => {
  await expectSignedInShell(page)
  await page.getByTestId('account-menu-trigger').click()
  await page.getByTestId('account-menu-profile').click()
  await expect
    .poll(() => openedExternalUrls(app))
    .toContain(`https://github.com/${FIXTURE.viewer.login}`)

  await page.getByTestId('account-menu-trigger').click()
  await page.getByTestId('account-menu-sign-out').click()
  await expect(page.getByTestId('sign-out-confirm')).toBeVisible()
  await page.getByTestId('sign-out-confirm-button').click()

  await expect(page.getByTestId('login-screen')).toBeVisible()
  expect((await invoke(page, 'auth:getSession')).state).toBe('signed_out')
})
