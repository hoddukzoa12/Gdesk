import type { ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import '@shared/ipc/queries'
import type { HomeSummary } from '@shared/domain/home'
import { resolveHomeCards, type HomeCardId } from '@shared/domain/homeCards'
import { Button, ErrorState, PageHeader, Spinner } from '@renderer/components'
import { useSettings } from '@renderer/lib/hooks/useSettings'
import { useIpcQuery } from '@renderer/lib/ipc'
import {
  FailedCiCard,
  ReviewRequestsCard,
  StarChangesCard,
  UnansweredCard,
  UnreadNotificationsCard
} from './HomeCards'

const CARD_RENDERERS: Record<HomeCardId, (home: HomeSummary) => ReactNode> = {
  reviewRequests: (home) => <ReviewRequestsCard data={home.reviewRequests} />,
  unreadNotifications: (home) => <UnreadNotificationsCard data={home.unreadNotifications} />,
  failedCi: (home) => <FailedCiCard data={home.failedCi} />,
  unanswered: (home) => <UnansweredCard data={home.unansweredContributions} />,
  starChanges: (home) => <StarChangesCard data={home.starChanges} />
}

/** Home: 할 일 요약 카드 (spec §4.2). */
export function HomePage() {
  const { t } = useTranslation('home')
  const navigate = useNavigate()
  const home = useIpcQuery('query:home')
  // 설정의 홈 카드 순서·표시. 설정이 바뀌면(`settings:changed`) 바로 반영한다
  const settings = useSettings()

  // 설정을 못 읽으면 기본 카드 구성을 쓴다
  const settingsReady = settings.isSuccess || settings.isError
  const cards = resolveHomeCards(settings.data?.homeCards ?? []).filter((c) => c.enabled)

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
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {cards.map((card) => (
          <div key={card.id} className="min-w-0">
            {CARD_RENDERERS[card.id](data)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="p-6" data-testid="home-page">
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
      {body}
    </div>
  )
}
