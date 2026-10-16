import type { Locator, Page } from '@playwright/test'
import { FIXTURE } from '../fixtures/github'
import { expect, test } from './support/fixtures'
import { invoke, openedExternalUrls, waitForAppShell } from './support/helpers'

// Issues 화면 개편 (spec §6): 탭·필터·정렬, 상세 패널, 쓰기(댓글·반응·닫기·새 이슈), 본문 정리

const SYNC_TIMEOUT = 20_000
const DEMO = FIXTURE.repos.demo.fullName
const ORG = FIXTURE.repos.orgWrite.fullName
const UPSTREAM = FIXTURE.repos.starredOther.fullName

const issueRow = (page: Page, repo: string, n: number) => page.getByTestId(`issue-row-${repo}#${n}`)
const tab = (page: Page, id: string) => page.locator(`[role="tab"][data-tab="${id}"]`)
const panel = (page: Page) => page.getByTestId('issue-panel')

function hashOf(page: Page): string {
  return new URL(page.url()).hash
}

async function openIssues(page: Page): Promise<void> {
  await waitForAppShell(page)
  await page.locator('[data-nav="issues"]').click()
  await expect(page.getByTestId('issues-page')).toBeVisible()
  await expect(issueRow(page, DEMO, 45)).toBeVisible({ timeout: SYNC_TIMEOUT })
}

/** 행을 눌러 패널을 열고 상세가 올 때까지 기다린다 */
async function openIssue(page: Page, repo: string, n: number, title: string): Promise<void> {
  await issueRow(page, repo, n).getByRole('button').first().click()
  await expect(page.getByTestId('issue-title')).toHaveText(title, { timeout: SYNC_TIMEOUT })
}

const ISSUE_45 = 'App freezes on large notification lists'

async function rowIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="issue-row-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''))
}

const reaction = (bar: Locator, content: string) => bar.locator(`[data-content="${content}"]`)

test('네 탭과 개수, 멘션 탭', async ({ page }) => {
  await openIssues(page)
  for (const id of ['incoming', 'assigned', 'mentioned', 'mine']) {
    await expect(page.getByTestId(`issues-count-${id}`)).toHaveText(/^\d+$/)
  }
  await expect(page.getByTestId('issues-count-mentioned')).toHaveText('3')

  await tab(page, 'mentioned').click()
  expect(hashOf(page)).toBe('#/issues?tab=mentioned')
  await expect(issueRow(page, DEMO, 45)).toBeVisible()
  await expect(issueRow(page, ORG, 7)).toBeVisible()
  await expect(issueRow(page, UPSTREAM, 91)).toBeVisible()
  await expect.poll(() => rowIds(page)).toHaveLength(3)
})

test('필터·정렬은 화면 안에서, 주소에 남고 뒤로 가기가 된다', async ({ page }) => {
  await openIssues(page)
  await expect(issueRow(page, DEMO, 44)).toBeVisible()
  await expect(issueRow(page, ORG, 8)).toBeVisible()

  // 저장소
  await page.getByTestId('issues-filter-repo').selectOption(String(FIXTURE.repos.orgWrite.id))
  await expect(issueRow(page, DEMO, 45)).toHaveCount(0)
  await expect(issueRow(page, ORG, 8)).toBeVisible()
  expect(hashOf(page)).toBe(`#/issues?repo=${FIXTURE.repos.orgWrite.id}`)
  await page.goBack()
  await expect(issueRow(page, DEMO, 45)).toBeVisible()

  // 라벨
  await page.getByTestId('issues-filter-label').selectOption('bug')
  await expect(issueRow(page, DEMO, 45)).toBeVisible()
  await expect(issueRow(page, DEMO, 44)).toHaveCount(0)
  await page.getByTestId('issues-filter-label').selectOption('')

  // 담당자: 101#44 는 나·alice, 201#8 은 나·dave
  await page.getByTestId('issues-filter-assignee').selectOption('dave-reviewer')
  await expect(issueRow(page, DEMO, 44)).toHaveCount(0)
  await page.getByTestId('issues-filter-assignee').selectOption('')

  // 정렬: 최신순(생성) 201#8(90시간 전) → 101#44(100시간 전), 최근 갱신순은 101#44(40) → 201#8(70)
  const before = await rowIds(page)
  expect(before.indexOf(`issue-row-${ORG}#8`)).toBeLessThan(before.indexOf(`issue-row-${DEMO}#44`))
  await page.getByTestId('issues-sort').selectOption('updated')
  expect(hashOf(page)).toBe('#/issues?sort=updated')
  await expect
    .poll(async () => {
      const ids = await rowIds(page)
      return ids.indexOf(`issue-row-${DEMO}#44`) < ids.indexOf(`issue-row-${ORG}#8`)
    })
    .toBe(true)
  await page.getByTestId('issues-sort').selectOption('comments')
  await expect.poll(async () => (await rowIds(page))[0]).toBe(`issue-row-${DEMO}#45`)
})

test('101#45 상세: 본문·연결 PR·커밋·반응·댓글, 악성 예시는 실행되지 않는다', async ({
  app,
  page
}) => {
  await openIssues(page)
  await openIssue(page, DEMO, 45, ISSUE_45)
  expect(hashOf(page)).toBe('#/issues?issue=101-45')
  await expect(issueRow(page, DEMO, 45)).toHaveAttribute('data-selected', 'true')

  const p = panel(page)
  await expect(p.getByTestId('issue-state')).toHaveAttribute('data-state', 'open')
  await expect(p.getByTestId('issue-body')).toContainText('The app freezes for several seconds')
  // 작업 목록 체크박스는 누를 수 없다
  const boxes = p.getByTestId('issue-body').locator('input[type="checkbox"]')
  await expect(boxes).toHaveCount(2)
  for (const box of await boxes.all()) await expect(box).toBeDisabled()

  // 연결 PR: #42 열림 · #38 병합 · #37 닫힘, 커밋 2
  await expect(p.getByTestId('linked-pr-42')).toHaveAttribute('data-state', 'open')
  await expect(p.getByTestId('linked-pr-38')).toHaveAttribute('data-state', 'merged')
  await expect(p.getByTestId('linked-pr-37')).toHaveAttribute('data-state', 'closed')
  await p.getByTestId('linked-tab-commits').click()
  await expect(p.locator('[data-testid^="linked-commit-"]')).toHaveCount(2)
  await p.locator('[data-testid^="linked-commit-"]').first().getByRole('button').click()
  await expect
    .poll(async () => (await openedExternalUrls(app)).some((u) => u.includes('/commit/')))
    .toBe(true)

  // 반응: 👍3 · 👀1(내 반응) · ❤️1
  const bar = p.getByTestId('issue-reactions')
  await expect(reaction(bar, 'THUMBS_UP')).toHaveAttribute('data-count', '3')
  await expect(reaction(bar, 'EYES')).toHaveAttribute('data-active', 'true')
  await expect(reaction(bar, 'HEART')).toHaveAttribute('data-count', '1')

  // 댓글 3개(오래된 순)
  await expect(p.locator('[data-testid^="issue-comment-"]')).toHaveCount(3)
  await expect(p.getByTestId('issue-comments')).toContainText('I can reproduce this')

  // 악성 예시: 실행되지 않고 DOM 에도 남지 않는다
  await expect(p.locator('script')).toHaveCount(0)
  await expect(p.locator('[onerror]')).toHaveCount(0)
  await expect(p.locator('a[href^="javascript:"]')).toHaveCount(0)
  // onerror 를 달고 있던 깨진 이미지는 대체 문구로
  await expect(p.getByTestId('issue-body').locator('.issue-img-alt')).toHaveText('broken')
  // 링크를 눌러도 아무 일도 없다(앱 창 이동 없음, 브라우저로 열지 않음)
  const opened = (await openedExternalUrls(app)).length
  await p.getByTestId('issue-body').getByText('click me').click()
  await p.getByTestId('issue-body').getByText('the notifications API').click()
  await expect
    .poll(async () => openedExternalUrls(app))
    .toContain('https://docs.github.com/rest/activity/notifications')
  expect((await openedExternalUrls(app)).length).toBe(opened + 1)
  expect(hashOf(page)).toBe('#/issues?issue=101-45')
  const flags = await page.evaluate(() => {
    const w = globalThis as unknown as Record<string, unknown>
    return [w.__gdeskXss, w.__gdeskXssImg, w.__gdeskXssLink, w.__gdeskXssComment]
  })
  expect(flags).toEqual([undefined, undefined, undefined, undefined])
})

test('댓글: 성공하면 비우고 새 댓글이 보인다, 실패하면 글을 남긴다', async ({ page, server }) => {
  await openIssues(page)
  await openIssue(page, DEMO, 45, ISSUE_45)
  const p = panel(page)
  const input = p.getByTestId('comment-input')
  const submit = p.getByTestId('comment-submit')
  await expect(submit).toBeDisabled()

  await input.fill('Thanks, **looking** into it')
  await expect(submit).toBeEnabled({ timeout: SYNC_TIMEOUT })
  await submit.click()
  await expect(input).toHaveValue('')
  await expect(p.locator('[data-testid^="issue-comment-"]')).toHaveCount(4, {
    timeout: SYNC_TIMEOUT
  })
  await expect(p.getByTestId('issue-comments')).toContainText('looking')

  server.failNextWrites(1)
  await input.fill('This one will fail')
  await submit.click()
  await expect(p.getByTestId('comment-error')).toBeVisible()
  await expect(input).toHaveValue('This one will fail')
  await expect(p.locator('[data-testid^="issue-comment-"]')).toHaveCount(4)
})

test('반응: 추가하면 수가 바뀌고, 실패하면 되돌린다', async ({ page, server }) => {
  await openIssues(page)
  await openIssue(page, DEMO, 45, ISSUE_45)
  const bar = panel(page).getByTestId('issue-reactions')

  await bar.getByTestId('reaction-picker-button').click()
  await page.getByTestId('reaction-option-ROCKET').click()
  await expect(reaction(bar, 'ROCKET')).toHaveAttribute('data-count', '1')
  await expect(reaction(bar, 'ROCKET')).toHaveAttribute('data-active', 'true')

  server.failNextWrites(1)
  await reaction(bar, 'THUMBS_UP').click()
  await expect(panel(page).getByTestId('issue-action-error')).toBeVisible()
  await expect(reaction(bar, 'THUMBS_UP')).toHaveAttribute('data-count', '3')
  await expect(reaction(bar, 'THUMBS_UP')).not.toHaveAttribute('data-active', 'true')
})

test('닫기: 이유를 골라 닫으면 닫힌 상태', async ({ page }) => {
  await openIssues(page)
  await openIssue(page, DEMO, 44, 'Support GitHub Enterprise Server')
  const p = panel(page)
  await p.getByTestId('issue-close-button').click()
  await page.getByTestId('issue-close-not_planned').click()
  await expect(p.getByTestId('issue-state')).toHaveAttribute('data-state', 'closed')
  await expect(p.getByTestId('issue-state')).toHaveAttribute('data-state-reason', 'not_planned')
  // 다시 열기 버튼으로 바뀐다
  await expect(p.getByTestId('issue-reopen-button')).toBeVisible()
})

test('새 이슈: 라벨·담당자와 함께 만들면 내가 올린 이슈 탭에서 열린다', async ({ page }) => {
  await openIssues(page)
  const button = page.getByTestId('new-issue-button')
  await expect(button).toBeEnabled({ timeout: SYNC_TIMEOUT })
  await button.click()
  const dialog = page.getByTestId('new-issue-dialog')
  await expect(dialog).toBeVisible()

  // 이슈 기능이 꺼진 dotfiles 는 보이지만 고를 수 없다
  const dotfiles = dialog.getByTestId(`new-issue-repo-${FIXTURE.issuesDisabledRepo.id}`)
  await expect(dotfiles).toHaveAttribute('aria-disabled', 'true')

  await dialog.getByTestId('new-issue-repo-search').fill('gdesk-demo')
  await dialog.getByTestId(`new-issue-repo-${FIXTURE.repos.demo.id}`).click()
  await dialog.getByTestId('new-issue-title').fill('Crash when opening settings')
  await dialog.getByTestId('new-issue-body-input').fill('Steps:\n\n1. Open settings')
  await dialog.getByTestId('new-issue-label-bug').click()
  await dialog.getByTestId(`new-issue-assignee-${FIXTURE.users.alice}`).click()
  await expect(dialog.getByTestId('new-issue-label-bug')).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByTestId('new-issue-submit').click()

  await expect(dialog).toHaveCount(0, { timeout: SYNC_TIMEOUT })
  await expect(tab(page, 'mine')).toHaveAttribute('aria-selected', 'true')
  expect(hashOf(page)).toBe('#/issues?tab=mine&issue=101-46')
  // 검색 반영 전(indexCreatedIssues 없이)에도 목록에 보이고 패널에 열린다
  await expect(issueRow(page, DEMO, 46)).toBeVisible({ timeout: SYNC_TIMEOUT })
  await expect(issueRow(page, DEMO, 46)).toHaveAttribute('data-selected', 'true')
  await expect(page.getByTestId('issue-title')).toHaveText('Crash when opening settings', {
    timeout: SYNC_TIMEOUT
  })
  await expect(panel(page).locator('[data-label="bug"]')).toBeVisible()
  await expect(panel(page).locator(`[data-assignee="${FIXTURE.users.alice}"]`)).toBeVisible()
})

test('잠긴 301#91: 댓글 대신 안내, 반응·닫기 버튼 없음', async ({ page }) => {
  await openIssues(page)
  await tab(page, 'mentioned').click()
  await openIssue(page, UPSTREAM, 91, 'Support async iterators')
  const p = panel(page)
  await expect(p.getByTestId('comment-locked-notice')).toBeVisible()
  await expect(p.getByTestId('comment-input')).toHaveCount(0)
  await expect(p.getByTestId('reaction-picker-button')).toHaveCount(0)
  await expect(p.getByTestId('issue-close-button')).toHaveCount(0)
})

test('오프라인이면 쓰기 버튼이 꺼진다', async ({ page, server }) => {
  await openIssues(page)
  await openIssue(page, DEMO, 45, ISSUE_45)
  const p = panel(page)
  await p.getByTestId('comment-input').fill('offline comment')
  await expect(p.getByTestId('comment-submit')).toBeEnabled({ timeout: SYNC_TIMEOUT })

  server.goOffline()
  await invoke(page, 'sync:refresh', { scope: 'issues' }).catch(() => undefined)
  await expect(p.getByTestId('comment-submit')).toBeDisabled({ timeout: SYNC_TIMEOUT })
  await expect(p.getByTestId('issue-blocked-hint')).toHaveAttribute('data-reason', 'offline')
  await expect(p.getByTestId('issue-close-button')).toBeDisabled()
  await expect(
    p.getByTestId('issue-reactions').getByTestId('reaction-picker-button')
  ).toBeDisabled()
  await expect(page.getByTestId('new-issue-button')).toBeDisabled()
  // 읽기는 계속된다: 받은 상세는 그대로 보인다
  await expect(p.getByTestId('issue-body')).toContainText('The app freezes')
})
