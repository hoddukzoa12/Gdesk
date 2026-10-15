import { FIXTURE } from '../fixtures/github'
import { expect, test } from './support/fixtures'
import { invoke, openedExternalUrls, waitForAppShell } from './support/helpers'

// 하네스 동작 확인: 테스트 빌드가 가짜 GitHub 에 붙어 로그인된 채로 뜨는가.
// 데이터 화면·동기화는 각 기능 작업이 자기 시나리오로 검사한다.

test.describe('토큰으로 시작', () => {
  test('로그인된 채로 앱 틀이 보이고 세션은 signed_in', async ({ page, server }) => {
    await waitForAppShell(page)
    const session = await invoke(page, 'auth:getSession')
    expect(session.state).toBe('signed_in')
    expect(session.user).toMatchObject({ id: FIXTURE.viewer.id, login: FIXTURE.viewer.login })
    expect(session.tokenKind).toBe('classic')
    expect(session.missingScopes).toEqual([])
    expect(session.inboxAvailable).toBe(true)

    // 앱은 시작할 때 GET /user 로 토큰을 확인했다(가짜 서버에, 테스트 토큰으로)
    const userCalls = server.findRequests('GET /user')
    expect(userCalls.length).toBeGreaterThan(0)
    expect(userCalls[0]?.token).toBe(FIXTURE.token)
  })

  test('테스트 모드이고 브라우저로 열기는 실제 브라우저 대신 기록된다', async ({ app, page }) => {
    await waitForAppShell(page)
    const info = await invoke(page, 'app:info')
    expect(info.testMode).toBe(true)
    const url = 'https://github.com/octo-maintainer/gdesk-demo'
    expect(await invoke(page, 'app:openExternal', { url })).toEqual({ opened: true })
    expect(await openedExternalUrls(app)).toEqual([url])
  })
})

test.describe('토큰 없이 시작', () => {
  test.use({ token: null })

  test('세션은 signed_out 이고 GitHub 에 토큰 확인을 보내지 않는다', async ({ page, server }) => {
    await expect.poll(async () => (await invoke(page, 'auth:getSession')).state).toBe('signed_out')
    const session = await invoke(page, 'auth:getSession')
    expect(session.user).toBeNull()
    expect(server.hasRequest('GET /user')).toBe(false)
  })
})
