// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import type { RepositoryDetail } from '@shared/domain/repo-detail'
import type { RepositorySummary } from '@shared/domain/repo'
import { i18n } from '@renderer/app/i18n'
import { RepoMetrics } from './RepoMetrics'
import { ContributorsCard, LanguagesCard } from './RepoAside'

const repository: RepositorySummary = {
  id: 7,
  owner: 'octo',
  ownerType: 'User',
  ownerAvatarUrl: null,
  name: 'empty',
  fullName: 'octo/empty',
  url: 'https://github.com/octo/empty',
  private: false,
  fork: false,
  archived: false,
  description: null,
  homepageUrl: null,
  primaryLanguage: null,
  primaryLanguageColor: null,
  defaultBranch: 'main',
  license: null,
  stargazerCount: 0,
  forkCount: 0,
  openPullRequestCount: 0,
  openIssueCount: 0,
  pushedAt: null,
  updatedAt: null,
  topics: [],
  viewerPermission: null,
  isMine: false,
  viewerHasStarred: false,
  starredAt: null,
  accessStatus: 'available'
}

function emptyDetail(over: Partial<RepositoryDetail> = {}): RepositoryDetail {
  return {
    repository,
    detailSyncedAt: null,
    openPullRequestCount: 0,
    openPullRequests: [],
    openPullRequestsComplete: true,
    myPullRequests: [],
    openIssueCount: 0,
    openIssues: [],
    openIssuesComplete: true,
    commits: [],
    latestCommitCi: 'none',
    latestRelease: null,
    releaseCount: 0,
    releases: [],
    languages: [],
    contributors: [],
    contributorCount: null,
    stars: { repoId: 7, daily: [], total: 0, truncated: false },
    ...over
  }
}

function renderUi(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('RepoMetrics', () => {
  it('빈 데이터: 0 · No CI · — · +0', () => {
    renderUi(<RepoMetrics detail={emptyDetail()} />)
    expect(screen.getByTestId('repo-metric-open-prs').textContent).toContain('0')
    const ci = screen.getByTestId('repo-metric-ci')
    expect(ci.textContent).toContain('CI on main, last 7 commits')
    expect(within(ci).getByTestId('repo-ci-summary').textContent).toBe('No CI')
    expect(ci.querySelectorAll('[data-status]').length).toBe(1) // 요약 단어만, 막대 없음
    expect(screen.getByTestId('repo-metric-release').textContent).toContain('—')
    expect(screen.getByTestId('repo-metric-stars').textContent).toContain('+0')
    expect(screen.getByTestId('repo-metric-stars').querySelector('svg')).toBeNull()
  })

  it('값이 있으면 막대 7개, 최신 커밋 기준 요약, 릴리스 태그, 스타 증가', () => {
    const statuses = [
      'passing',
      'failing',
      'pending',
      'none',
      'failing',
      'pending',
      'passing'
    ] as const
    const now = new Date()
    renderUi(
      <RepoMetrics
        detail={emptyDetail({
          openPullRequestCount: 4,
          commits: statuses.map((ciStatus, i) => ({
            sha: `${i}`.repeat(40),
            shortSha: `${i}`.repeat(7),
            message: `c${i}`,
            author: null,
            authorName: 'x',
            committedAt: now.toISOString(),
            url: 'https://github.com/octo/empty/commit/x',
            ciStatus
          })),
          latestRelease: {
            id: 'r',
            tagName: 'v1.2.0',
            name: 'v1.2.0',
            publishedAt: new Date(now.getTime() - 10 * 86_400_000).toISOString(),
            createdAt: now.toISOString(),
            isPrerelease: false,
            isDraft: false,
            isLatest: true,
            url: 'https://github.com/octo/empty/releases/tag/v1.2.0'
          },
          stars: {
            repoId: 7,
            daily: [
              { date: '2026-10-14', count: 3 },
              { date: '2026-10-15', count: 25 }
            ],
            total: 28,
            truncated: false
          }
        })}
      />
    )
    expect(screen.getByTestId('repo-metric-open-prs').textContent).toContain('4')
    const ci = screen.getByTestId('repo-metric-ci')
    const bars = ci.querySelectorAll('span[data-status]:not([data-testid])')
    expect(bars.length).toBe(7)
    // 막대는 과거 → 최신 순이라 마지막 막대가 최신 커밋
    expect(bars[6]?.getAttribute('data-status')).toBe('passing')
    expect(within(ci).getByTestId('repo-ci-summary').textContent).toBe('Passing')
    expect(screen.getByTestId('repo-metric-release').textContent).toContain('v1.2.0')
    expect(screen.getByTestId('repo-metric-release').textContent).toContain('10d ago')
    expect(screen.getByTestId('repo-metric-stars').textContent).toContain('+28')
    expect(
      within(screen.getByTestId('repo-metric-stars')).getByRole('img', {
        name: 'New stars per day over the last 30 days'
      })
    ).toBeTruthy()
  })

  it('한국어 문구', async () => {
    await i18n.changeLanguage('ko')
    renderUi(<RepoMetrics detail={emptyDetail()} />)
    expect(screen.getByTestId('repo-metric-ci').textContent).toContain('main CI, 최근 커밋 7개')
    expect(screen.getByTestId('repo-ci-summary').textContent).toBe('CI 없음')
  })
})

describe('LanguagesCard · ContributorsCard', () => {
  it('언어 막대 색과 퍼센트', () => {
    renderUi(
      <LanguagesCard
        languages={[
          { name: 'TypeScript', color: '#3178c6', bytes: 96, ratio: 0.96 },
          { name: 'Rust', color: null, bytes: 4, ratio: 0.04 }
        ]}
      />
    )
    const items = screen.getAllByTestId('repo-language')
    expect(items.map((i) => i.textContent)).toEqual(['TypeScript96%', 'Rust4%'])
    const dot = items[0]?.querySelector('span[aria-hidden]') as HTMLElement
    expect(dot.style.backgroundColor).toBe('rgb(49, 120, 198)')
    expect(screen.getByRole('img', { name: /TypeScript 96%, Rust 4%/ })).toBeTruthy()
  })

  it('빈 언어·기여자', () => {
    renderUi(
      <>
        <LanguagesCard languages={[]} />
        <ContributorsCard contributors={[]} total={null} />
      </>
    )
    expect(screen.getByText('No languages detected')).toBeTruthy()
    expect(screen.getByText('No contributors yet')).toBeTruthy()
    expect(screen.getByTestId('repo-contributors').getAttribute('data-count')).toBe('0')
  })

  it('기여자는 20명까지 보이고 총 인원을 쓴다', () => {
    const contributors = Array.from({ length: 22 }, (_, i) => ({
      login: `user${i}`,
      avatarUrl: null,
      url: null,
      contributions: 30 - i
    }))
    renderUi(<ContributorsCard contributors={contributors} total={25} />)
    const card = screen.getByTestId('repo-contributors')
    expect(card.querySelectorAll('li[title]').length).toBe(20)
    expect(card.textContent).toContain('25')
    expect(card.textContent).toContain('+5')
  })
})
