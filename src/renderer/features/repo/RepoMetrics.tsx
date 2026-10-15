import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { RepositoryDetail } from '@shared/domain/repo-detail'
import {
  CI_STATUS_META,
  MetricCard,
  MetricGrid,
  MiniBars,
  RelativeTime,
  Sparkline
} from '@renderer/components'
import { cn } from '@renderer/lib/cn'
import { ciBars, ciSummary } from './repo-detail'

/** MetricGrid 칸. MetricCard 는 data-testid 를 받지 않으므로 칸을 감싼다. */
function Cell({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0" data-testid={testId}>
      {children}
    </div>
  )
}

/** 개요 탭 위의 지표 카드 4개(spec §4.9). */
export function RepoMetrics({ detail }: { detail: RepositoryDetail }) {
  const { t, i18n } = useTranslation('repo')
  const { t: tc } = useTranslation('common')
  const nf = new Intl.NumberFormat(i18n.language)
  const branch = detail.repository.defaultBranch
  const ci = ciSummary(detail.commits)
  const bars = ciBars(detail.commits)
  const release = detail.latestRelease
  const releaseDate = release ? (release.publishedAt ?? release.createdAt) : null
  const daily = detail.stars.daily.map((d) => d.count)

  return (
    <MetricGrid>
      <Cell testId="repo-metric-open-prs">
        <MetricCard
          className="flex-1"
          label={t('metrics.openPulls')}
          value={nf.format(detail.openPullRequestCount)}
        />
      </Cell>
      <Cell testId="repo-metric-ci">
        <MetricCard
          className="flex-1"
          label={branch ? t('metrics.ci', { branch }) : t('metrics.ciNoBranch')}
        >
          <div className="flex h-6 items-center gap-2.5">
            {bars.length > 0 && <MiniBars statuses={bars} />}
            <span
              className={cn('text-[13px] font-medium', CI_STATUS_META[ci].colorClass)}
              data-testid="repo-ci-summary"
              data-status={ci}
            >
              {tc(CI_STATUS_META[ci].labelKey)}
            </span>
          </div>
        </MetricCard>
      </Cell>
      <Cell testId="repo-metric-release">
        <MetricCard
          className="flex-1"
          label={t('metrics.latestRelease')}
          value={release ? release.tagName : t('metrics.none')}
          aside={releaseDate ? <RelativeTime date={releaseDate} /> : undefined}
        />
      </Cell>
      <Cell testId="repo-metric-stars">
        <MetricCard className="flex-1" label={t('metrics.stars')}>
          <div className="flex min-w-0 items-end gap-3">
            <div className="flex shrink-0 items-baseline gap-1.5">
              <span
                className="text-2xl leading-none font-semibold text-accent tabular-nums"
                title={detail.stars.truncated ? t('metrics.partial') : undefined}
              >
                {`+${nf.format(detail.stars.total)}`}
                {detail.stars.truncated ? '*' : ''}
              </span>
              <span className="text-xs text-fg-muted">{t('metrics.thisMonth')}</span>
            </div>
            {daily.length > 0 && (
              <div className="min-w-0 flex-1">
                <Sparkline values={daily} height={26} label={t('metrics.starsTrend')} />
              </div>
            )}
          </div>
        </MetricCard>
      </Cell>
    </MetricGrid>
  )
}
