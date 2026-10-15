import type { Page } from '@playwright/test'
import { expect, test } from './support/fixtures'
import { invoke, openedExternalUrls, waitForAppShell } from './support/helpers'

// 저장소 상세 화면(spec §4.9, 참고 이미지). 가짜 GitHub 의 101 octo-maintainer/gdesk-demo 기준:
// 스타 129(최근 30일 28), 기여자 25, 열린 PR 4, 커밋 7, 릴리스 4(최신 v1.2.0, 사전 v1.3.0-beta.1).

const SYNC_TIMEOUT = 20_000

async function openRepo(page: Page, repoId: number): Promise<void> {
  await waitForAppShell(page)
  await page.evaluate((id) => {
    // 노드 설정(tsconfig.node)에는 DOM 타입이 없다
    ;(globalThis as unknown as { location: { hash: string } }).location.hash = `#/repos/${id}`
  }, repoId)
  await expect(page.getByTestId('repo-detail-page')).toHaveAttribute('data-state', 'ready', {
    timeout: SYNC_TIMEOUT
  })
}

/** 상세 수집까지 끝났을 때(최신 릴리스가 보일 때)까지 기다린다 */
async function waitForDetail(page: Page): Promise<void> {
  await expect(page.getByTestId('repo-metric-release')).toContainText('v1.2.0', {
    timeout: SYNC_TIMEOUT
  })
}

/**
 * 스타 30일 창은 이 컴퓨터 시간대의 달력 날짜 단위(오늘 + 앞 29일)다. 고정 데이터의 가장 오래된 최근 스타는
 * 약 29.6일 전이라, 현지 시각이 오후 2시 전이면 창 밖으로 빠진다. 앱을 현지 시각이 18시 무렵인 시간대로
 * 띄워 언제 돌려도 "최근 30일 28개"가 되게 한다.
 */
function eveningTimeZone(now = new Date()): string {
  let offset = 18 - now.getUTCHours()
  if (offset > 14) offset -= 24
  if (offset === 0) return 'UTC'
  // Etc/GMT 이름은 부호가 반대다(Etc/GMT-9 = UTC+9)
  return `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`
}

test('개요: 지표 4개 · 열린 PR · 커밋 · 언어 · 기여자, 들어가면 상세를 받는다', async ({
  launchGdesk,
  server
}) => {
  const { app, page } = await launchGdesk({ env: { TZ: eveningTimeZone() } })
  await openRepo(page, 101)
  // 들어가면 상세 추적이 되어 바로 상세를 받는다
  await server.waitForRequest('GRAPHQL GdeskRepositoryDetail', SYNC_TIMEOUT)
  await waitForDetail(page)

  await expect(page.getByTestId('repo-name')).toHaveText('gdesk-demo')
  await expect(page.getByTestId('repo-metric-open-prs')).toContainText('4')
  await expect(page.getByTestId('repo-metric-stars')).toContainText('+28')
  const bars = page.getByTestId('repo-metric-ci').locator('[role="img"] > [data-status]')
  await expect(bars).toHaveCount(7)
  // 최신 커밋(SUCCESS) 기준 요약
  await expect(page.getByTestId('repo-ci-summary')).toHaveAttribute('data-status', 'passing')

  await expect(page.getByTestId('repo-pr-42')).toBeVisible()
  await expect(page.getByTestId('repo-open-prs').locator('[data-testid^="repo-pr-"]')).toHaveCount(
    4
  )
  await expect(
    page.getByTestId('repo-commits').locator('[data-testid^="repo-commit-"]')
  ).toHaveCount(7)
  await expect(page.getByTestId('repo-contributors')).toHaveAttribute('data-count', '25')
  await expect(page.getByTestId('repo-contributors')).toContainText('25')
  const languages = page.getByTestId('repo-language')
  await expect(languages).toHaveCount(4)
  await expect(languages.first()).toContainText('TypeScript')

  // 항목을 누르면 GitHub 페이지를 브라우저로 연다
  await page.getByTestId('repo-pr-42').getByRole('button').first().click()
  await page.getByTestId('repo-fork-button').click()
  await expect
    .poll(() => openedExternalUrls(app))
    .toEqual([
      `${server.webBase}/octo-maintainer/gdesk-demo/pull/42`,
      `${server.webBase}/octo-maintainer/gdesk-demo/fork`
    ])
})

test('스타 토글: 취소하면 128, 실패하면 오류를 보이고 원래대로', async ({ page, server }) => {
  await openRepo(page, 101)
  await waitForDetail(page)
  const star = page.getByTestId('repo-star-button')
  const count = page.getByTestId('repo-star-count')
  const root = page.getByTestId('repo-detail-page')

  await expect(star).toHaveAttribute('aria-pressed', 'true')
  await expect(count).toHaveText('129')

  await star.click()
  await expect(star).toHaveAttribute('aria-pressed', 'false')
  await expect(count).toHaveText('128')
  await server.waitForRequest('DELETE /user/starred/octo-maintainer/gdesk-demo')
  await expect(star).toBeEnabled()
  await expect(root.getByRole('alert')).toHaveCount(0)

  // 다시 스타하려는데 GitHub 가 실패: 오류를 보이고 클릭 전 상태(스타 안 함, 128)로 돌아온다
  server.failNextWrites(1)
  await star.click()
  await expect(root.getByRole('alert')).toBeVisible()
  await expect(star).toHaveAttribute('aria-pressed', 'false')
  await expect(count).toHaveText('128')
  expect(server.hasRequest('PUT /user/starred/octo-maintainer/gdesk-demo')).toBe(true)
})

test('오프라인이면 스타 버튼이 꺼진다', async ({ page, server }) => {
  await openRepo(page, 101)
  await waitForDetail(page)
  const star = page.getByTestId('repo-star-button')
  await expect(star).toBeEnabled()

  server.goOffline()
  // 새로고침 요청이 네트워크 오류를 받으면 연결 상태가 offline 이 된다
  await invoke(page, 'sync:refresh', { scope: 'repo:101' }).catch(() => undefined)
  await expect(star).toBeDisabled({ timeout: SYNC_TIMEOUT })
})

test('내 저장소가 아닌 저장소도 받아서 보여 준다', async ({ page, server }) => {
  await openRepo(page, 302)
  await expect(page.getByTestId('repo-name')).toHaveText('tiny-utils')
  // 보고 있는 저장소로 상세를 받았다(노드 ID R_kgDO302)
  await server.waitForRequest(
    (r) => r.key === 'GRAPHQL GdeskRepositoryDetail' && r.variables?.id === 'R_kgDO302',
    SYNC_TIMEOUT
  )
})

test('릴리스 탭: 4개, 사전 릴리스 표시', async ({ app, page, server }) => {
  await openRepo(page, 101)
  await waitForDetail(page)
  await page.getByTestId('repo-tab-releases').click()
  const releases = page.getByTestId('repo-releases')
  await expect(releases.locator('[data-testid^="repo-release-v"]')).toHaveCount(4)
  const beta = page.getByTestId('repo-release-v1.3.0-beta.1')
  await expect(beta.getByTestId('repo-release-prerelease')).toBeVisible()
  await expect(releases.getByTestId('repo-release-prerelease')).toHaveCount(1)

  await page.getByTestId('repo-release-v1.2.0').getByRole('button').first().click()
  await expect
    .poll(() => openedExternalUrls(app))
    .toEqual([`${server.webBase}/octo-maintainer/gdesk-demo/releases/tag/v1.2.0`])
})
