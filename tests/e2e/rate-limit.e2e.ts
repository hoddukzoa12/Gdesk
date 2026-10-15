import { expect, test } from './support/fixtures'
import { invoke, waitForAppShell } from './support/helpers'

// 요청 한도 초과(spec §6): GitHub 가 403 + x-ratelimit-remaining: 0 을 주면 연결 상태가 rate_limited 가 되고,
// 사이드바 하단이 그 상태를 보이며 쓰기 버튼이 꺼진다. 문구 대신 data 속성·data-testid 로 확인한다.

const SYNC_TIMEOUT = 20_000

test('한도 초과면 하단이 rate_limited, 쓰기 버튼은 꺼지고 요청을 보내지 않는다', async ({
  page,
  server
}) => {
  await waitForAppShell(page)
  await page.locator('[data-nav="inbox"]').click()
  await expect(page.getByTestId('inbox-page')).toBeVisible()
  await expect(page.locator('[data-testid^="inbox-row-"]')).toHaveCount(9, {
    timeout: SYNC_TIMEOUT
  })
  await expect(page.getByTestId('inbox-done-9001')).toBeEnabled()
  const footer = page.getByTestId('sync-footer')
  await expect(footer).toHaveAttribute('data-connection', 'online')

  // 한 시간 뒤에 풀리는 1차 한도 초과
  const resetAt = Math.floor(Date.now() / 1000) + 3600
  server.setRateLimited(resetAt)
  await invoke(page, 'sync:refresh', { scope: 'inbox' }).catch(() => undefined)

  await expect(footer).toHaveAttribute('data-connection', 'rate_limited', {
    timeout: SYNC_TIMEOUT
  })
  const status = await invoke(page, 'sync:getStatus')
  expect(status.connection).toBe('rate_limited')
  expect(status.rateLimitedUntil).toBe(resetAt * 1000)

  for (const id of ['9001', '9004', '9009']) {
    await expect(page.getByTestId(`inbox-done-${id}`)).toBeDisabled()
  }
  await expect(page.getByTestId('inbox-blocked-hint')).toBeVisible()

  // 막힌 동안에는 GitHub 로 요청을 보내지 않는다(수동 새로고침도 막힌다)
  server.clearRequests()
  await invoke(page, 'sync:refresh', { scope: 'inbox' }).catch(() => undefined)
  expect(server.requestKeys().filter((k) => k !== 'GET /rate_limit')).toEqual([])
})
