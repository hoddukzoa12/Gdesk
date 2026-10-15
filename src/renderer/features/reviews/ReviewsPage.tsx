import { useTranslation } from 'react-i18next'
import '@shared/ipc/queries'
import { CountBadge, PageHeader } from '@renderer/components'
import { useIpcQuery } from '@renderer/lib/ipc'
import { ListView, MoreHint, githubListUrl } from '../pulls/ListView'
import { PrRow, prRowTestId } from '../pulls/PrRow'

/** Review requests (spec §4.5): 나나 내 팀에게 리뷰가 요청된 열린 PR */
export function ReviewsPage() {
  const { t } = useTranslation('reviews')
  const query = useIpcQuery('query:reviews')
  return (
    <section data-testid="reviews-page">
      <PageHeader
        breadcrumb={[
          {
            label: (
              <span className="inline-flex items-center gap-1.5">
                {t('title')}
                <CountBadge count={query.data?.totalCount} />
              </span>
            )
          }
        ]}
      />
      <ListView
        query={query}
        label={t('title')}
        emptyTitle={t('empty.title')}
        emptyDescription={t('empty.description')}
        errorMessage={t('error')}
        moreHint={(page) => (
          <MoreHint
            text={t('more.text', { shown: page.items.length, total: page.totalCount })}
            linkLabel={t('more.link')}
            url={githubListUrl(page.items, '/pulls/review-requested')}
          />
        )}
        itemKey={(pr) => pr.id}
        itemTestId={prRowTestId}
        renderItem={(pr) => <PrRow pr={pr} />}
      />
    </section>
  )
}
