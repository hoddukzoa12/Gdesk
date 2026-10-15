import { GitPullRequest, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SidebarRepoItem } from '@shared/domain/queries'

/** 사이드바 저장소 줄 오른쪽: 열린 PR 수(있을 때만) · 스타 수. */
export function RepoTrailing({ item }: { item: SidebarRepoItem }) {
  const { t, i18n } = useTranslation('sidebar')
  const nf = new Intl.NumberFormat(i18n.language)
  const prs = item.openPullRequestCount ?? 0
  return (
    <>
      {prs > 0 && (
        <span
          className="inline-flex items-center gap-0.5"
          title={t('repo.openPullRequests', { value: prs })}
          data-testid={`sidebar-repo-prs-${item.repoId}`}
        >
          <GitPullRequest size={11} aria-hidden />
          <span className="sr-only">{t('repo.openPullRequests', { value: prs })}</span>
          <span aria-hidden>{nf.format(prs)}</span>
        </span>
      )}
      {item.stargazerCount !== null && (
        <span
          className="inline-flex items-center gap-0.5"
          title={t('repo.stars', { value: item.stargazerCount })}
        >
          <Star size={11} aria-hidden />
          <span className="sr-only">{t('repo.stars', { value: item.stargazerCount })}</span>
          <span aria-hidden>{nf.format(item.stargazerCount)}</span>
        </span>
      )}
    </>
  )
}
