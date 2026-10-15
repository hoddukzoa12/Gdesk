import { useTranslation } from 'react-i18next'
import type { RepositoryDetail } from '@shared/domain/repo-detail'
import { EmptyState, ExternalLink, SectionCard } from '@renderer/components'
import { AboutCard, ContributorsCard, LanguagesCard } from './RepoAside'
import { RepoMetrics } from './RepoMetrics'
import { CommitRow, IssueRow, MoreOnGitHub, PullRow, ReleaseRow } from './RepoRows'
import { repoLink } from './repo-detail'

/** 개요: 지표 4개 + 왼쪽(열린 PR, 최근 커밋) · 오른쪽(About, Languages, Contributors). 1100px 미만이면 한 줄로 쌓는다. */
export function OverviewTab({ detail }: { detail: RepositoryDetail }) {
  const { t } = useTranslation('repo')
  const repo = detail.repository
  const branch = repo.defaultBranch
  return (
    <div className="flex flex-col gap-4">
      <RepoMetrics detail={detail} />
      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div data-testid="repo-open-prs">
            <SectionCard
              title={t('pulls.title')}
              count={detail.openPullRequestCount}
              actions={
                <ExternalLink href={repoLink(repo.url, 'pulls')} showIcon>
                  {t('pulls.allOnGitHub')}
                </ExternalLink>
              }
            >
              {detail.openPullRequests.length === 0 ? (
                <EmptyState compact title={t('pulls.empty')} />
              ) : (
                detail.openPullRequests.map((pr) => <PullRow key={pr.id} pr={pr} />)
              )}
              {!detail.openPullRequestsComplete && (
                <MoreOnGitHub href={repoLink(repo.url, 'pulls')} />
              )}
            </SectionCard>
          </div>
          <div data-testid="repo-commits">
            <SectionCard
              title={t('commits.title')}
              subtitle={branch ?? undefined}
              actions={
                <ExternalLink
                  href={repoLink(repo.url, branch ? `commits/${branch}` : 'commits')}
                  showIcon
                >
                  {t('commits.history')}
                </ExternalLink>
              }
            >
              {detail.commits.length === 0 ? (
                <EmptyState compact title={t('commits.empty')} />
              ) : (
                detail.commits.map((c) => <CommitRow key={c.sha} commit={c} />)
              )}
            </SectionCard>
          </div>
        </div>
        <aside className="flex min-w-0 flex-col gap-4">
          <AboutCard detail={detail} />
          <LanguagesCard languages={detail.languages} />
          <ContributorsCard contributors={detail.contributors} total={detail.contributorCount} />
        </aside>
      </div>
    </div>
  )
}

/** 내 PR 탭: 이 저장소에서 내가 연 열린 PR */
export function MyPullsTab({ detail }: { detail: RepositoryDetail }) {
  const { t } = useTranslation('repo')
  const repo = detail.repository
  return (
    <div data-testid="repo-my-prs">
      <SectionCard
        title={t('pulls.mineTitle')}
        count={detail.myPullRequests.length}
        actions={
          <ExternalLink href={repoLink(repo.url, 'pulls/@me')} showIcon>
            {t('actions.openOnGitHub')}
          </ExternalLink>
        }
      >
        {detail.myPullRequests.length === 0 ? (
          <EmptyState compact title={t('pulls.mineEmpty')} />
        ) : (
          detail.myPullRequests.map((pr) => <PullRow key={pr.id} pr={pr} showReview />)
        )}
      </SectionCard>
    </div>
  )
}

/** 이슈 탭: 열린 이슈 */
export function IssuesTab({ detail }: { detail: RepositoryDetail }) {
  const { t } = useTranslation('repo')
  const repo = detail.repository
  return (
    <div data-testid="repo-issues">
      <SectionCard
        title={t('issues.title')}
        count={detail.openIssueCount}
        actions={
          <ExternalLink href={repoLink(repo.url, 'issues')} showIcon>
            {t('actions.openOnGitHub')}
          </ExternalLink>
        }
      >
        {detail.openIssues.length === 0 ? (
          <EmptyState compact title={t('issues.empty')} />
        ) : (
          detail.openIssues.map((issue) => <IssueRow key={issue.id} issue={issue} />)
        )}
        {!detail.openIssuesComplete && <MoreOnGitHub href={repoLink(repo.url, 'issues')} />}
      </SectionCard>
    </div>
  )
}

/** 릴리스 탭: 태그 · 이름 · 날짜 · 사전 릴리스 */
export function ReleasesTab({ detail }: { detail: RepositoryDetail }) {
  const { t } = useTranslation('repo')
  const repo = detail.repository
  return (
    <div data-testid="repo-releases">
      <SectionCard
        title={t('releases.title')}
        count={detail.releaseCount}
        actions={
          <ExternalLink href={repoLink(repo.url, 'releases')} showIcon>
            {t('actions.openOnGitHub')}
          </ExternalLink>
        }
      >
        {detail.releases.length === 0 ? (
          <EmptyState compact title={t('releases.empty')} />
        ) : (
          detail.releases.map((r) => <ReleaseRow key={r.id} release={r} />)
        )}
        {detail.releaseCount > detail.releases.length && (
          <MoreOnGitHub href={repoLink(repo.url, 'releases')} />
        )}
      </SectionCard>
    </div>
  )
}
