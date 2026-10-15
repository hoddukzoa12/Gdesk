// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import type { GdeskApi } from '@shared/ipc/contract'
import type { PrReviewStatus, PullRequestRow } from '@shared/domain/pr'
import { i18n } from '@renderer/app/i18n'
import { PrRow, prRowTestId } from './PrRow'

function pr(overrides: Partial<PullRequestRow> = {}): PullRequestRow {
  return {
    id: 'PR_1',
    repoId: 101,
    repoFullName: 'octo-maintainer/gdesk-demo',
    number: 42,
    title: 'Add keyboard shortcuts',
    url: 'https://github.com/octo-maintainer/gdesk-demo/pull/42',
    author: { login: 'alice-dev', avatarUrl: null, isBot: false },
    state: 'open',
    reviewStatus: 'none',
    ciStatus: 'passing',
    commentCount: 0,
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
    ...overrides
  }
}

let invoke: ReturnType<typeof vi.fn>

function renderRow(row: PullRequestRow) {
  return render(
    <I18nextProvider i18n={i18n}>
      <div data-testid={prRowTestId(row)}>
        <PrRow pr={row} />
      </div>
    </I18nextProvider>
  )
}

beforeEach(async () => {
  invoke = vi.fn(async () => ({ opened: true }))
  window.gdesk = { invoke, on: () => () => {} } as unknown as GdeskApi
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('PrRow', () => {
  it('저장소·번호·제목·작성자·CI 를 보여 준다', () => {
    renderRow(pr({ ciStatus: 'failing' }))
    expect(screen.getByText('Add keyboard shortcuts')).toBeTruthy()
    expect(screen.getByText('octo-maintainer/gdesk-demo')).toBeTruthy()
    expect(screen.getByText('#42')).toBeTruthy()
    expect(screen.getByText('alice-dev')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Failing' }).getAttribute('data-status')).toBe('failing')
    expect(screen.getByTestId('pr-row-octo-maintainer/gdesk-demo#42')).toBeTruthy()
  })

  it.each<[PrReviewStatus, string]>([
    ['approved', 'Approved'],
    ['changes_requested', 'Changes requested'],
    ['review_required', 'Review required']
  ])('리뷰 상태 %s 배지', (status, text) => {
    const { container } = renderRow(pr({ reviewStatus: status }))
    const badge = container.querySelector('[data-review]')
    expect(badge?.getAttribute('data-review')).toBe(status)
    expect(badge?.textContent).toBe(text)
  })

  it('리뷰 상태 none 은 배지를 그리지 않는다', () => {
    const { container } = renderRow(pr({ reviewStatus: 'none' }))
    expect(container.querySelector('[data-review]')).toBeNull()
  })

  it('초안이면 Draft 배지, 열린 PR 이면 없다', () => {
    const { container, unmount } = renderRow(pr({ state: 'draft' }))
    expect(container.querySelector('[data-draft]')?.textContent).toBe('Draft')
    unmount()
    const open = renderRow(pr({ state: 'open' }))
    expect(open.container.querySelector('[data-draft]')).toBeNull()
  })

  it('한국어 문구', async () => {
    await i18n.changeLanguage('ko')
    renderRow(pr({ state: 'draft', reviewStatus: 'changes_requested' }))
    expect(screen.getByText('초안')).toBeTruthy()
    expect(screen.getByText('변경 요청됨')).toBeTruthy()
  })

  it('행을 누르면 GitHub 페이지를 브라우저로 연다', () => {
    renderRow(pr())
    fireEvent.click(
      screen.getByRole('button', { name: 'octo-maintainer/gdesk-demo#42 Add keyboard shortcuts' })
    )
    expect(invoke).toHaveBeenCalledWith('app:openExternal', {
      url: 'https://github.com/octo-maintainer/gdesk-demo/pull/42'
    })
  })
})
