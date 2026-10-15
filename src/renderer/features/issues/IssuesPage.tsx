import { useTranslation } from 'react-i18next'
import '@shared/ipc/queries'
import { ISSUES_TABS, type IssuesTab } from '@shared/domain/queries'
import {
  CountBadge,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@renderer/components'
import { useIpcQuery } from '@renderer/lib/ipc'
import { ListView, MoreHint, githubListUrl } from '../pulls/ListView'
import { useTabParam } from '../pulls/useTabParam'
import { IssueRow, issueRowTestId } from './IssueRow'

/** "GitHub 에서 더 보기" 경로 */
const MORE_PATH: Record<IssuesTab, string> = {
  incoming: '/issues?q=is%3Aopen+is%3Aissue+-author%3A%40me',
  assigned: '/issues/assigned',
  mine: '/issues'
}

function IssuesList({ tab }: { tab: IssuesTab }) {
  const { t } = useTranslation('issues')
  const query = useIpcQuery('query:issues', { tab })
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
      itemKey={(issue) => issue.id}
      itemTestId={issueRowTestId}
      renderItem={(issue) => <IssueRow issue={issue} />}
    />
  )
}

/** 탭 옆 수치. 캐시만 읽으므로 모든 탭을 미리 읽어도 싸다 */
function TabCount({ tab }: { tab: IssuesTab }) {
  const query = useIpcQuery('query:issues', { tab })
  return <CountBadge count={query.data?.totalCount} />
}

/** Issues (spec §4.6): 들어온 이슈 · 나에게 할당 · 내가 올린 이슈. PR 은 섞지 않는다 */
export function IssuesPage() {
  const { t } = useTranslation('issues')
  const [tab, setTab] = useTabParam(ISSUES_TABS)
  return (
    <Tabs value={tab} onValueChange={setTab} data-testid="issues-page">
      <PageHeader
        breadcrumb={[{ label: t('title') }]}
        tabs={
          <TabsList aria-label={t('tabs.label')} className="app-no-drag">
            {ISSUES_TABS.map((id) => (
              <TabsTrigger key={id} value={id} data-tab={id}>
                {t(`tabs.${id}`)}
                <TabCount tab={id} />
              </TabsTrigger>
            ))}
          </TabsList>
        }
      />
      {ISSUES_TABS.map((id) => (
        <TabsContent key={id} value={id}>
          <IssuesList tab={id} />
        </TabsContent>
      ))}
    </Tabs>
  )
}
