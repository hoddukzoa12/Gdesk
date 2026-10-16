import type { ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import '@shared/ipc/queries'
import type { HomeQueryResult } from '@shared/domain/queries'
import { resolveHomeSections, type HomeSectionId } from '@shared/domain/homeCards'
import { Button, ErrorState, PageHeader, Spinner } from '@renderer/components'
import { useSettings } from '@renderer/lib/hooks/useSettings'
import { useIpcQuery } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/cn'
import {
  ContributionsSection,
  MyPullRequestsCard,
  PinnedReposSection,
  RecentCommitsCard,
  StatsSection
} from './ActivitySections'
import { Greeting } from './Greeting'
import {
  FailedCiCard,
  ReviewRequestsCard,
  StarChangesCard,
  UnansweredCard,
  UnreadNotificationsCard
} from './HomeCards'
import { FULL_WIDTH_SECTIONS } from './home-logic'

const SECTION_RENDERERS: Record<HomeSectionId, (home: HomeQueryResult) => ReactNode> = {
  stats: (home) => <StatsSection stats={home.stats} />,
  pinnedRepos: (home) => <PinnedReposSection repos={home.pinnedRepos} />,
  contributions: (home) => <ContributionsSection calendar={home.contributions} />,
  recentCommits: (home) => <RecentCommitsCard data={home.recentCommits} />,
  myPullRequests: (home) => <MyPullRequestsCard data={home.myPullRequests} />,
  reviewRequests: (home) => <ReviewRequestsCard data={home.reviewRequests} />,
  unreadNotifications: (home) => <UnreadNotificationsCard data={home.unreadNotifications} />,
  failedCi: (home) => <FailedCiCard data={home.failedCi} />,
  unanswered: (home) => <UnansweredCard data={home.unansweredContributions} />,
  starChanges: (home) => <StarChangesCard data={home.starChanges} />
}

/**
 * Home: 인사말(늘 맨 위) + 설정 순서대로 영역 열 개(spec §4.2, §5).
 * 수치는 한 줄을 다 쓰고, 나머지는 창 너비 1100px 이상에서 두 열로 흐른다(아래 `min-[1100px]` 한 곳에서 조정).
 */
export function HomePage() {
  const { t } = useTranslation('home')
  const navigate = useNavigate()
  const home = useIpcQuery('query:home')
  // 설정의 홈 카드 순서·표시. 설정이 바뀌면(`settings:changed`) 바로 반영한다
  const settings = useSettings()

  // 설정을 못 읽으면 기본 구성을 쓴다
  const settingsReady = settings.isSuccess || settings.isError
  const sections = resolveHomeSections(settings.data?.homeCards ?? []).filter((s) => s.enabled)

  let body: ReactNode
  if (home.isError && !home.data) {
    body = <ErrorState message={t('loadError')} onRetry={() => void home.refetch()} />
  } else if (!home.data || !settingsReady) {
    body = (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    )
  } else {
    const data = home.data
    body = (
      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-2" data-testid="home-sections">
        {sections.map(({ id }) => (
          <div
            key={id}
            className={cn('flex min-w-0 flex-col [&>*]:flex-1', {
              'col-span-full': FULL_WIDTH_SECTIONS.has(id)
            })}
          >
            {SECTION_RENDERERS[id](data)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 p-6" data-testid="home-page">
      <PageHeader
        breadcrumb={[{ label: t('title') }]}
        actions={
          <Button
            size="sm"
            onClick={() => void navigate({ pathname: '/settings', hash: '#home-cards' })}
          >
            <SlidersHorizontal />
            {t('customize')}
          </Button>
        }
      />
      <Greeting />
      {body}
    </div>
  )
}
