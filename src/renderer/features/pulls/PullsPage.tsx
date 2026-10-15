import { useTranslation } from 'react-i18next'
import '@shared/ipc/queries'
import { PULLS_TABS, type PullsTab } from '@shared/domain/queries'
import {
  CountBadge,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@renderer/components'
import { useIpcQuery } from '@renderer/lib/ipc'
import { ListView, MoreHint, githubListUrl } from './ListView'
import { PrRow, prRowTestId } from './PrRow'
import { useTabParam } from './useTabParam'

/** "GitHub 에서 더 보기" 경로 */
const MORE_PATH: Record<PullsTab, string> = {
  incoming: '/pulls?q=is%3Aopen+is%3Apr+-author%3A%40me',
  mine: '/pulls'
}

function PullsList({ tab }: { tab: PullsTab }) {
  const { t } = useTranslation('pulls')
  const query = useIpcQuery('query:pulls', { tab })
  return (
    <ListView
      query={query}
      label={t(`tabs.${tab}`)}
      emptyTitle={t(`empty.${tab}.title`)}
      emptyDescription={t(`empty.${tab}.description`)}
      errorMessage={t('error')}
      moreHint={(page) => (
        <MoreHint
          text={t('more.text', { shown: page.items.length, total: page.totalCount })}
          linkLabel={t('more.link')}
          url={githubListUrl(page.items, MORE_PATH[tab])}
        />
      )}
      itemKey={(pr) => pr.id}
      itemTestId={prRowTestId}
      renderItem={(pr) => <PrRow pr={pr} />}
    />
  )
}

/** 탭 옆 수치. 캐시만 읽으므로 두 탭 모두 미리 읽어도 싸다. */
function TabCount({ tab }: { tab: PullsTab }) {
  const query = useIpcQuery('query:pulls', { tab })
  return <CountBadge count={query.data?.totalCount} />
}

/** Pull requests (spec §4.4): 들어온 PR · 내가 올린 PR */
export function PullsPage() {
  const { t } = useTranslation('pulls')
  const [tab, setTab] = useTabParam(PULLS_TABS)
  return (
    <Tabs value={tab} onValueChange={setTab} data-testid="pulls-page">
      <PageHeader
        breadcrumb={[{ label: t('title') }]}
        tabs={
          <TabsList aria-label={t('tabs.label')} className="app-no-drag">
            {PULLS_TABS.map((id) => (
              <TabsTrigger key={id} value={id} data-tab={id}>
                {t(`tabs.${id}`)}
                <TabCount tab={id} />
              </TabsTrigger>
            ))}
          </TabsList>
        }
      />
      {PULLS_TABS.map((id) => (
        <TabsContent key={id} value={id}>
          <PullsList tab={id} />
        </TabsContent>
      ))}
    </Tabs>
  )
}
