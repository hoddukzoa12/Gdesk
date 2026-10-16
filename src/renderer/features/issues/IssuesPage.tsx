import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import '@shared/ipc/queries'
import type { CreatedIssue } from '@shared/domain/issue-actions'
import { ISSUES_TABS, type IssuesTab } from '@shared/domain/queries'
import {
  Button,
  CountBadge,
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger
} from '@renderer/components'
import { useActionAvailability } from '@renderer/lib/hooks/useActionAvailability'
import { cn } from '@renderer/lib/cn'
import { invoke } from '@renderer/lib/ipc'
import { MoreHint, githubListUrl } from '../pulls/ListView'
import { IssueDetailPanel } from './IssueDetailPanel'
import { IssueRow, issueRowTestId } from './IssueRow'
import {
  ISSUE_SORTS,
  applyFilters,
  blockedKey,
  filterOptions,
  parseUrlState,
  sameIssue,
  serializeUrlState,
  updateUrlState,
  type FilterOption,
  type IssuesUrlState
} from './issues-logic'
import { NewIssueDialog } from './NewIssueDialog'

/** "GitHub 에서 더 보기" 경로 */
const MORE_PATH: Record<IssuesTab, string> = {
  incoming: '/issues?q=is%3Aopen+is%3Aissue+-author%3A%40me',
  assigned: '/issues/assigned',
  mentioned: '/issues/mentioned',
  mine: '/issues'
}

/**
 * 탭·필터·정렬·연 이슈를 주소 검색 값에 둔다. 바꿀 때마다 기록이 남아 뒤로 가기가 동작한다.
 * Radix 탭은 mousedown·focus 로 두 번 알리므로, 같은 상태로의 이동은 한 번만 기록한다.
 */
export function useIssuesUrlState(): [IssuesUrlState, (patch: Partial<IssuesUrlState>) => void] {
  const [params, setParams] = useSearchParams()
  const search = params.toString()
  const state = useMemo(() => parseUrlState(new URLSearchParams(search)), [search])
  const current = useRef(state)
  useEffect(() => {
    current.current = state
  }, [state])
  const update = useCallback(
    (patch: Partial<IssuesUrlState>) => {
      const prev = current.current
      const next = updateUrlState(prev, patch)
      const nextSearch = serializeUrlState(next)
      if (nextSearch.toString() === serializeUrlState(prev).toString()) return
      current.current = next
      setParams(nextSearch)
    },
    [setParams]
  )
  return [state, update]
}

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
  testId
}: {
  label: string
  allLabel: string
  value: string | null
  options: FilterOption[]
  onChange: (value: string | null) => void
  testId: string
}) {
  // 주소에만 있고 목록에 없는 값도 고른 상태로 보이게 한다
  const all =
    value !== null && !options.some((o) => o.value === value)
      ? [...options, { value, label: value }]
      : options
  return (
    <SelectShell>
      <select
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        data-testid={testId}
        className={selectClass}
      >
        <option value="">{allLabel}</option>
        {all.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </SelectShell>
  )
}

const selectClass = cn(
  'h-8 max-w-56 appearance-none truncate rounded-md border border-border bg-bg-subtle pr-7 pl-3 text-[13px] text-fg',
  'hover:border-border-strong focus:border-border-strong focus:outline-none'
)

function SelectShell({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-flex">
      {children}
      <ChevronDown
        size={14}
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-fg-muted"
      />
    </span>
  )
}

/** Issues (spec §6.1–6.3): 목록 + 오른쪽 상세 패널 */
export function IssuesPage() {
  const { t } = useTranslation('issues')
  const [state, update] = useIssuesUrlState()
  const [newIssueOpen, setNewIssueOpen] = useState(false)
  const availability = useActionAvailability()
  const { tab } = state

  const query = useQuery({
    queryKey: ['query:issues', { tab }],
    queryFn: () => invoke('query:issues', { tab })
  })
  const page = query.data?.page
  const counts = query.data?.counts
  const rows = useMemo(() => page?.items ?? [], [page])
  const options = useMemo(() => filterOptions(rows), [rows])
  const visible = useMemo(
    () =>
      applyFilters(rows, {
        repo: state.repo,
        label: state.label,
        assignee: state.assignee,
        sort: state.sort
      }),
    [rows, state.repo, state.label, state.assignee, state.sort]
  )
  const selectedRow = state.issue
    ? (rows.find((r) => sameIssue({ repoId: r.repoId, number: r.number }, state.issue)) ?? null)
    : null
  const filtered = state.repo !== null || state.label !== null || state.assignee !== null

  const onCreated = (issue: CreatedIssue): void => {
    setNewIssueOpen(false)
    update({ tab: 'mine', issue: { repoId: issue.repoId, number: issue.number } })
  }

  let list: ReactNode
  if (query.isPending) {
    list = (
      <div className="flex justify-center py-12" data-testid="list-loading">
        <Spinner />
      </div>
    )
  } else if (query.isError || !page) {
    list = <ErrorState message={t('error')} onRetry={() => void query.refetch()} />
  } else if (rows.length === 0) {
    list = (
      <div data-testid="list-empty">
        <EmptyState title={t(`empty.${tab}.title`)} description={t(`empty.${tab}.description`)} />
      </div>
    )
  } else {
    list = (
      <>
        {visible.length === 0 ? (
          <div data-testid="list-filtered-empty">
            <EmptyState
              title={t('filters.noMatch')}
              action={
                <Button
                  onClick={() => update({ repo: null, label: null, assignee: null })}
                  data-testid="issues-filter-clear"
                >
                  {t('filters.clear')}
                </Button>
              }
            />
          </div>
        ) : (
          <ul
            aria-label={t(`tabs.${tab}`)}
            className="divide-y divide-border"
            data-testid="issues-list"
          >
            {visible.map((issue) => {
              const ref = { repoId: issue.repoId, number: issue.number }
              const selected = sameIssue(ref, state.issue)
              return (
                <li
                  key={issue.id}
                  data-testid={issueRowTestId(issue)}
                  data-selected={selected || undefined}
                >
                  <IssueRow
                    issue={issue}
                    selected={selected}
                    onSelect={() => update({ issue: ref })}
                  />
                </li>
              )
            })}
          </ul>
        )}
        {!page.complete && (
          <div
            className="border-t border-border px-4 py-3 text-xs text-fg-muted"
            data-testid="list-more"
          >
            <MoreHint
              text={t('more.text', { shown: page.items.length, total: page.totalCount })}
              linkLabel={t('more.link')}
              url={githubListUrl(page.items, MORE_PATH[tab])}
            />
          </div>
        )}
      </>
    )
  }

  const blocked = availability && !availability.available ? availability.reason : null

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="issues-page">
      <PageHeader breadcrumb={[{ label: t('title') }]} />

      {/* 머리글 */}
      <div className="flex shrink-0 items-start gap-4 px-6 pt-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{t('title')}</h1>
          <p className="text-[13px] text-fg-muted">{t('subtitle')}</p>
        </div>
        <Button
          variant="primary"
          onClick={() => setNewIssueOpen(true)}
          disabled={availability?.available !== true}
          title={blocked ? t(blockedKey(blocked)) : undefined}
          data-testid="new-issue-button"
        >
          <Plus />
          {t('newIssue.button')}
        </Button>
      </div>

      {/* 탭 */}
      <Tabs
        value={tab}
        onValueChange={(next) => {
          const found = ISSUES_TABS.find((id) => id === next)
          if (found) update({ tab: found })
        }}
        className="shrink-0 px-6 pt-4"
      >
        <TabsList aria-label={t('tabs.label')} className="gap-1 border-b border-border pb-2">
          {ISSUES_TABS.map((id) => (
            <TabsTrigger key={id} value={id} data-tab={id} className="h-7 px-2.5">
              {t(`tabs.${id}`)}
              <CountBadge
                count={counts?.[id]}
                showZero
                data-testid={`issues-count-${id}`}
                data-count={counts?.[id]}
                className="rounded-full bg-bg-hover px-1.5 py-0.5"
              />
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* 필터 · 정렬 */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-2 px-6 py-3"
        role="group"
        aria-label={t('filters.label')}
      >
        <FilterSelect
          label={t('filters.byRepo')}
          allLabel={t('filters.allRepos')}
          value={state.repo === null ? null : String(state.repo)}
          options={options.repos}
          onChange={(v) => update({ repo: v === null ? null : Number(v) })}
          testId="issues-filter-repo"
        />
        <FilterSelect
          label={t('filters.byLabel')}
          allLabel={t('filters.allLabels')}
          value={state.label}
          options={options.labels}
          onChange={(v) => update({ label: v })}
          testId="issues-filter-label"
        />
        <FilterSelect
          label={t('filters.byAssignee')}
          allLabel={t('filters.allAssignees')}
          value={state.assignee}
          options={options.assignees}
          onChange={(v) => update({ assignee: v })}
          testId="issues-filter-assignee"
        />
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => update({ repo: null, label: null, assignee: null })}
          >
            {t('filters.clear')}
          </Button>
        )}
        <span className="ml-auto">
          <SelectShell>
            <select
              aria-label={t('sort.label')}
              value={state.sort}
              onChange={(e) => {
                const found = ISSUE_SORTS.find((s) => s === e.target.value)
                if (found) update({ sort: found })
              }}
              data-testid="issues-sort"
              className={selectClass}
            >
              {ISSUE_SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`sort.${s}`)}
                </option>
              ))}
            </select>
          </SelectShell>
        </span>
      </div>

      {/* 목록 + 상세 패널 */}
      <div className="flex min-h-0 flex-1 gap-4 px-6 pb-5">
        <section
          className="min-h-0 w-[44%] min-w-[320px] shrink-0 overflow-y-auto rounded-lg border border-border"
          aria-label={t(`tabs.${tab}`)}
          data-testid="issues-list-pane"
        >
          {list}
        </section>
        <aside
          className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-lg border border-border bg-bg-elevated/40"
          aria-label={t('detail.label')}
          data-testid="issue-panel-pane"
        >
          <IssueDetailPanel
            issueRef={state.issue}
            row={selectedRow}
            onClose={() => update({ issue: null })}
          />
        </aside>
      </div>

      <NewIssueDialog open={newIssueOpen} onOpenChange={setNewIssueOpen} onCreated={onCreated} />
    </div>
  )
}
