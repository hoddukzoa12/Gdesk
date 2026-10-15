import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { ArrowUpRight, PinOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import '@shared/ipc/actions'
import '@shared/ipc/pins'
import '@shared/ipc/queries'
import '@shared/ipc/sync'
import type { RepoDetailQueryResult } from '@shared/domain/queries'
import {
  Avatar,
  Banner,
  Button,
  CountBadge,
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  openExternal,
  type BreadcrumbItem
} from '@renderer/components'
import { useActionAvailability } from '@renderer/lib/hooks/useActionAvailability'
import { invoke, queryClient, useIpcEvent, useIpcQuery } from '@renderer/lib/ipc'
import { RepoHeader } from './RepoHeader'
import { IssuesTab, MyPullsTab, OverviewTab, ReleasesTab } from './RepoTabs'
import { repoLink } from './repo-detail'

type RepoTab = 'overview' | 'myPulls' | 'issues' | 'releases'

function parseRepoId(value: string | undefined): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** 보고 있는 저장소를 메인에 알린다(진입·변경 시 repoId, 이탈 시 null). 상세 추적 + 즉시 받기. */
function useViewedRepo(repoId: number | null): void {
  useEffect(() => {
    if (repoId === null) return
    void invoke('sync:setViewedRepo', { repoId }).catch(() => undefined)
    return () => {
      void invoke('sync:setViewedRepo', { repoId: null }).catch(() => undefined)
    }
  }, [repoId])
}

function invalidateRepoDetail(): void {
  // 고정은 data:changed 를 보내지 않으므로 pins:changed 로 다시 읽는다
  void queryClient.invalidateQueries({ queryKey: ['query:repoDetail'] })
}

/** `#/repos/:repoId` — 저장소 상세 화면(spec §4.9, 참고 이미지) */
export function RepoDetailPage() {
  const { t } = useTranslation('repo')
  const { repoId: param } = useParams()
  const repoId = parseRepoId(param)
  useViewedRepo(repoId)

  if (repoId === null) {
    return (
      <div className="p-6" data-testid="repo-detail-page" data-state="invalid">
        <PageHeader breadcrumb={[{ label: t('crumb') }]} />
        <EmptyState title={t('invalid')} />
      </div>
    )
  }
  return <RepoDetailView key={repoId} repoId={repoId} />
}

function RepoDetailView({ repoId }: { repoId: number }) {
  const { t } = useTranslation('repo')
  const query = useIpcQuery('query:repoDetail', { repoId })
  useIpcEvent('pins:changed', invalidateRepoDetail)

  if (query.isError && query.data === undefined) {
    return (
      <div className="p-6" data-testid="repo-detail-page" data-state="error">
        <PageHeader breadcrumb={[{ label: t('crumb') }]} />
        <ErrorState message={t('loadFailed')} onRetry={() => void query.refetch()} />
      </div>
    )
  }

  const data = query.data
  if (data === undefined || data === null) {
    // 캐시에 아직 없다(검색 결과·받지 않은 스타 저장소 등). 진입 때 받기를 시작했으니 data:changed 를 기다린다.
    return (
      <div className="p-6" data-testid="repo-detail-page" data-state="loading">
        <PageHeader breadcrumb={[{ label: t('crumb') }]} />
        <EmptyState
          icon={<Spinner size={28} />}
          title={t('loading')}
          description={data === null ? t('loadingHint') : undefined}
        />
      </div>
    )
  }

  return <RepoDetailLoaded repoId={repoId} data={data} />
}

function RepoDetailLoaded({ repoId, data }: { repoId: number; data: RepoDetailQueryResult }) {
  const { t } = useTranslation('repo')
  const { t: tc } = useTranslation('common')
  const availability = useActionAvailability()
  const [tab, setTab] = useState<RepoTab>('overview')
  const [error, setError] = useState<string | null>(null)
  const [starBusy, setStarBusy] = useState(false)
  const [pinBusy, setPinBusy] = useState(false)

  const { detail, pinned, accessStatus } = data
  const repo = detail.repository

  const blockedReason =
    availability === undefined
      ? null
      : availability.available
        ? null
        : t(`blocked.${availability.reason}`)

  const toggleStar = useCallback(async () => {
    setError(null)
    setStarBusy(true)
    try {
      const result = await invoke('actions:star', { repoId, starred: !repo.viewerHasStarred })
      if (!result.ok) {
        setError(
          result.reason === 'failed'
            ? `${t('errors.star')} ${result.message}`
            : `${t('errors.star')} ${t(`blocked.${result.reason}`)}`
        )
      }
    } catch {
      setError(t('errors.star'))
    } finally {
      setStarBusy(false)
    }
  }, [repoId, repo.viewerHasStarred, t])

  const togglePin = useCallback(async () => {
    setError(null)
    setPinBusy(true)
    try {
      await invoke(pinned ? 'pins:unpin' : 'pins:pin', { repoId })
      invalidateRepoDetail()
    } catch {
      setError(t('errors.pin'))
    } finally {
      setPinBusy(false)
    }
  }, [pinned, repoId, t])

  const breadcrumb: BreadcrumbItem[] = [
    {
      label: repo.owner,
      icon: (
        <Avatar
          src={repo.ownerAvatarUrl}
          name={repo.owner}
          size={16}
          shape={repo.ownerType === 'Organization' ? 'square' : 'circle'}
        />
      )
    },
    { label: repo.name }
  ]

  const openOnGitHub = (
    <Button size="sm" onClick={() => void openExternal(repo.url)} data-testid="repo-open-github">
      {tc('actions.openOnGitHub')}
      <ArrowUpRight aria-hidden />
    </Button>
  )

  const errorBanner = error && (
    <Banner variant="error" onDismiss={() => setError(null)} className="rounded-lg">
      {error}
    </Banner>
  )

  if (accessStatus === 'unavailable') {
    return (
      <div className="p-6" data-testid="repo-detail-page" data-state="unavailable">
        <PageHeader breadcrumb={breadcrumb} actions={openOnGitHub} />
        {errorBanner}
        <div data-testid="repo-unavailable">
          <EmptyState
            title={t('unavailable.title')}
            description={t('unavailable.description')}
            action={
              pinned ? (
                <Button
                  onClick={() => void togglePin()}
                  disabled={pinBusy}
                  data-testid="repo-pin-button"
                >
                  <PinOff aria-hidden />
                  {t('actions.unpin')}
                </Button>
              ) : undefined
            }
          />
        </div>
      </div>
    )
  }

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as RepoTab)}>
      <PageHeader
        breadcrumb={breadcrumb}
        tabs={
          <TabsList aria-label={t('tabs.label')}>
            <TabsTrigger value="overview" data-testid="repo-tab-overview">
              {t('tabs.overview')}
            </TabsTrigger>
            <TabsTrigger value="myPulls" data-testid="repo-tab-my-prs">
              {t('tabs.myPulls')}
              <CountBadge count={detail.myPullRequests.length} />
            </TabsTrigger>
            <TabsTrigger value="issues" data-testid="repo-tab-issues">
              {t('tabs.issues')}
              <CountBadge count={detail.openIssueCount} />
            </TabsTrigger>
            <TabsTrigger value="releases" data-testid="repo-tab-releases">
              {t('tabs.releases')}
              <CountBadge count={detail.releaseCount} />
            </TabsTrigger>
          </TabsList>
        }
        actions={openOnGitHub}
      />
      <div
        className="mx-auto flex max-w-[1400px] flex-col gap-5 px-6 py-5"
        data-testid="repo-detail-page"
        data-state="ready"
        data-repo-id={repoId}
      >
        <RepoHeader
          repo={repo}
          pinned={pinned}
          writeBlockedReason={blockedReason}
          starBusy={starBusy}
          pinBusy={pinBusy}
          onToggleStar={() => void toggleStar()}
          onFork={() => void openExternal(repoLink(repo.url, 'fork'))}
          onTogglePin={() => void togglePin()}
        />
        {errorBanner}
        <TabsContent value="overview">
          <OverviewTab detail={detail} />
        </TabsContent>
        <TabsContent value="myPulls">
          <MyPullsTab detail={detail} />
        </TabsContent>
        <TabsContent value="issues">
          <IssuesTab detail={detail} />
        </TabsContent>
        <TabsContent value="releases">
          <ReleasesTab detail={detail} />
        </TabsContent>
      </div>
    </Tabs>
  )
}
