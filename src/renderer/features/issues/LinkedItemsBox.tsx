import { useState } from 'react'
import { GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  LinkedPullRequest,
  LinkedPullRequestState,
  ReferencingCommit
} from '@shared/domain/issue-detail'
import {
  Avatar,
  CountBadge,
  ListRow,
  RelativeTime,
  Tabs,
  TabsList,
  TabsTrigger,
  openExternal
} from '@renderer/components'
import { cn } from '@renderer/lib/cn'

type LinkedTab = 'prs' | 'commits'

const PR_STATE_CLASS: Record<LinkedPullRequestState, string> = {
  open: 'bg-success/15 text-success',
  merged: 'bg-merged/15 text-merged',
  closed: 'bg-danger/15 text-danger'
}

const PR_STATE_ICON: Record<LinkedPullRequestState, typeof GitPullRequest> = {
  open: GitPullRequest,
  merged: GitMerge,
  closed: GitPullRequestClosed
}

function PrStatePill({ state }: { state: LinkedPullRequestState }) {
  const { t } = useTranslation('issues')
  const Icon = PR_STATE_ICON[state]
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-[4.5rem] shrink-0 items-center justify-center gap-1 rounded-full px-2 text-[11px] font-medium',
        PR_STATE_CLASS[state]
      )}
      data-pr-state={state}
    >
      <Icon size={12} aria-hidden />
      {t(`linked.prState.${state}`)}
    </span>
  )
}

export interface LinkedItemsBoxProps {
  pullRequests: readonly LinkedPullRequest[]
  commits: readonly ReferencingCommit[]
}

/**
 * 연결된 PR·커밋 작은 창(spec §6.2, 시안의 안쪽 창 자리). PR 탭 / 커밋 탭. 누르면 GitHub 페이지를 연다.
 */
export function LinkedItemsBox({ pullRequests, commits }: LinkedItemsBoxProps) {
  const { t } = useTranslation('issues')
  const [tab, setTab] = useState<LinkedTab>(
    pullRequests.length === 0 && commits.length > 0 ? 'commits' : 'prs'
  )
  const empty = pullRequests.length === 0 && commits.length === 0

  return (
    <section
      className="rounded-lg border border-border bg-bg-elevated"
      aria-label={t('linked.title')}
      data-testid="issue-linked"
    >
      {empty ? (
        <p className="px-4 py-4 text-[13px] text-fg-muted" data-testid="issue-linked-empty">
          {t('linked.empty')}
        </p>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v === 'commits' ? 'commits' : 'prs')}>
          <div className="border-b border-border px-3 py-2">
            <TabsList aria-label={t('linked.title')}>
              <TabsTrigger value="prs" data-testid="linked-tab-prs">
                {t('linked.pullRequests')}
                <CountBadge count={pullRequests.length} />
              </TabsTrigger>
              <TabsTrigger value="commits" data-testid="linked-tab-commits">
                {t('linked.commits')}
                <CountBadge count={commits.length} />
              </TabsTrigger>
            </TabsList>
          </div>
          {tab === 'prs' ? (
            pullRequests.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-fg-muted">{t('linked.noPullRequests')}</p>
            ) : (
              <ul className="divide-y divide-border" aria-label={t('linked.pullRequests')}>
                {pullRequests.map((pr) => (
                  <li
                    key={`${pr.repoFullName}#${pr.number}`}
                    data-testid={`linked-pr-${pr.number}`}
                    data-state={pr.state}
                  >
                    <ListRow
                      onSelect={() => void openExternal(pr.url)}
                      selectLabel={`${pr.repoFullName}#${pr.number} ${pr.title}`}
                      icon={<PrStatePill state={pr.state} />}
                      leading={`#${pr.number}`}
                      title={pr.title}
                      meta={pr.repoFullName}
                    />
                  </li>
                ))}
              </ul>
            )
          ) : commits.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-fg-muted">{t('linked.noCommits')}</p>
          ) : (
            <ul className="divide-y divide-border" aria-label={t('linked.commits')}>
              {commits.map((c) => {
                const short = c.sha.slice(0, 7)
                const author = c.author?.login ?? c.authorName ?? t('linked.unknownAuthor')
                return (
                  <li key={c.sha} data-testid={`linked-commit-${short}`}>
                    <ListRow
                      onSelect={() => void openExternal(c.url)}
                      selectLabel={`${short} ${c.message}`}
                      icon={
                        c.author ? (
                          <Avatar src={c.author.avatarUrl} name={c.author.login} size={20} />
                        ) : (
                          <GitCommitHorizontal size={16} aria-hidden />
                        )
                      }
                      title={c.message}
                      meta={
                        <span className="inline-flex items-center gap-1.5">
                          <span>{author}</span>
                          {c.committedAt && (
                            <>
                              <span aria-hidden>·</span>
                              <RelativeTime date={c.committedAt} style="long" />
                            </>
                          )}
                        </span>
                      }
                      right={<span className="font-mono text-[11px]">{short}</span>}
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </Tabs>
      )}
    </section>
  )
}
