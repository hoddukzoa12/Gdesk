import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Lock, Search } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import '@shared/ipc/issue-actions'
import '@shared/ipc/queries'
import {
  MAX_ISSUE_ASSIGNEES,
  MAX_ISSUE_LABELS,
  type CreatedIssue
} from '@shared/domain/issue-actions'
import type { IssueRepoOption } from '@shared/domain/issue-detail'
import { Avatar, Button, Spinner, focusRing } from '@renderer/components'
import { useActionAvailability } from '@renderer/lib/hooks/useActionAvailability'
import { cn } from '@renderer/lib/cn'
import { invoke, useIpcQuery } from '@renderer/lib/ipc'
import { LabelChip } from './IssueRow'
import { blockedKey, failureMessage } from './issues-logic'
import { MarkdownEditor } from './MarkdownEditor'

/** 저장소 검색: 전체 이름 부분 일치(대소문자 무시) */
export function filterRepoOptions(
  options: readonly IssueRepoOption[],
  search: string
): IssueRepoOption[] {
  const q = search.trim().toLowerCase()
  if (!q) return [...options]
  return options.filter((o) => o.fullName.toLowerCase().includes(q))
}

export interface NewIssueDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 만든 뒤(대화상자를 닫고 "내가 올린 이슈" 탭에 연다) */
  onCreated: (issue: CreatedIssue) => void
}

/** "+ 새 이슈" 작성 대화상자(spec §6.3). 열 때마다 양식을 처음부터 시작한다 */
export function NewIssueDialog({ open, onOpenChange, onCreated }: NewIssueDialogProps) {
  const { t } = useTranslation('issues')
  const [creating, setCreating] = useState(false)
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // 만드는 동안에는 닫지 않는다(결과를 잃지 않게)
        if (!next && creating) return
        onOpenChange(next)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          data-testid="new-issue-dialog"
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2',
            'flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-bg-elevated p-5 text-fg shadow-2xl'
          )}
        >
          <div className="flex flex-col gap-1">
            <Dialog.Title className="text-[15px] font-semibold">{t('newIssue.title')}</Dialog.Title>
            <Dialog.Description className="text-[13px] text-fg-muted">
              {t('newIssue.description')}
            </Dialog.Description>
          </div>
          {open && (
            <NewIssueForm
              creating={creating}
              setCreating={setCreating}
              onCancel={() => onOpenChange(false)}
              onCreated={onCreated}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function NewIssueForm({
  creating,
  setCreating,
  onCancel,
  onCreated
}: {
  creating: boolean
  setCreating: (value: boolean) => void
  onCancel: () => void
  onCreated: (issue: CreatedIssue) => void
}) {
  const { t } = useTranslation('issues')
  const availability = useActionAvailability()
  const reposQuery = useIpcQuery('query:issueRepoOptions')
  const [search, setSearch] = useState('')
  const [repoId, setRepoId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [labels, setLabels] = useState<string[]>([])
  const [assignees, setAssignees] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const repos = useMemo(() => reposQuery.data ?? [], [reposQuery.data])
  const visible = useMemo(() => filterRepoOptions(repos, search), [repos, search])
  const selectedRepo = repos.find((r) => r.repoId === repoId) ?? null

  const meta = useQuery({
    queryKey: ['issueActions:repoMeta', { repoId }],
    queryFn: () => invoke('issueActions:repoMeta', { repoId: repoId as number }),
    enabled: repoId !== null,
    staleTime: 0,
    gcTime: 0
  })
  const metaData = meta.data?.ok ? meta.data : null

  const pickRepo = (option: IssueRepoOption): void => {
    if (!option.hasIssuesEnabled || option.repoId === repoId) return
    setRepoId(option.repoId)
    setLabels([])
    setAssignees([])
    setError(null)
  }

  const toggle = (list: string[], value: string, max = Infinity): string[] =>
    list.includes(value)
      ? list.filter((v) => v !== value)
      : list.length >= max
        ? list
        : [...list, value]

  const blocked = availability && !availability.available ? availability.reason : null
  const canSubmit =
    !creating && repoId !== null && title.trim() !== '' && availability?.available === true

  const submit = async (): Promise<void> => {
    if (!canSubmit || repoId === null) return
    setCreating(true)
    setError(null)
    try {
      const res = await invoke('issueActions:create', {
        repoId,
        title,
        ...(body.trim() !== '' ? { body } : {}),
        ...(labels.length > 0 ? { labels } : {}),
        ...(assignees.length > 0 ? { assignees } : {})
      })
      setCreating(false)
      if (res.ok) onCreated(res.issue)
      else setError(failureMessage(res, t))
    } catch {
      setCreating(false)
      setError(t('failure.failed'))
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {/* 저장소 */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xs font-medium text-fg-muted">{t('newIssue.repo')}</legend>
        <div className="relative">
          <Search
            size={14}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-subtle"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('newIssue.repoSearch')}
            aria-label={t('newIssue.repoSearch')}
            data-testid="new-issue-repo-search"
            className="h-8 w-full rounded-md border border-border bg-bg pr-3 pl-8 text-[13px] text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
          />
        </div>
        <div
          role="listbox"
          aria-label={t('newIssue.repo')}
          className="max-h-44 overflow-y-auto rounded-md border border-border"
          data-testid="new-issue-repo-list"
        >
          {reposQuery.isPending ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : visible.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-fg-muted">{t('newIssue.noRepos')}</p>
          ) : (
            visible.map((option) => {
              const selected = option.repoId === repoId
              const disabled = !option.hasIssuesEnabled
              return (
                <div
                  key={option.repoId}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={disabled || undefined}
                  tabIndex={disabled ? -1 : 0}
                  data-testid={`new-issue-repo-${option.repoId}`}
                  data-disabled={disabled || undefined}
                  onClick={() => pickRepo(option)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      pickRepo(option)
                    }
                  }}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 text-[13px]',
                    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-default hover:bg-bg-hover',
                    selected && 'bg-bg-subtle',
                    focusRing,
                    'focus-visible:ring-inset'
                  )}
                >
                  <Avatar src={option.ownerAvatarUrl} name={option.owner} size={16} />
                  <span className="min-w-0 flex-1 truncate">{option.fullName}</span>
                  {option.private && <Lock size={12} aria-hidden className="text-fg-subtle" />}
                  {disabled && (
                    <span className="shrink-0 text-xs text-fg-subtle">
                      {t('newIssue.issuesDisabled')}
                    </span>
                  )}
                  {selected && <Check size={14} aria-hidden className="text-accent" />}
                </div>
              )
            })
          )}
        </div>
        {selectedRepo && (
          <p className="text-xs text-fg-muted" data-testid="new-issue-selected-repo">
            {t('newIssue.selectedRepo', { repo: selectedRepo.fullName })}
          </p>
        )}
      </fieldset>

      {/* 제목 */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">{t('newIssue.titleLabel')}</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('newIssue.titlePlaceholder')}
          required
          data-testid="new-issue-title"
          className="h-8 rounded-md border border-border bg-bg px-3 text-[13px] text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
        />
      </label>

      {/* 본문 */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">{t('newIssue.bodyLabel')}</span>
        <MarkdownEditor
          repoId={repoId}
          value={body}
          onChange={setBody}
          placeholder={t('newIssue.bodyPlaceholder')}
          label={t('newIssue.bodyLabel')}
          disabled={creating}
          testIdPrefix="new-issue-body"
          rows={6}
        />
      </div>

      {/* 라벨·담당자 */}
      {repoId !== null && (
        <div className="flex flex-col gap-3" data-testid="new-issue-meta">
          {meta.isPending ? (
            <Spinner />
          ) : !metaData ? (
            <p role="alert" className="text-[13px] text-danger" data-testid="new-issue-meta-error">
              {meta.data && !meta.data.ok ? failureMessage(meta.data, t) : t('failure.failed')}
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-fg-muted">{t('newIssue.labels')}</span>
                {metaData.labels.length === 0 ? (
                  <p className="text-xs text-fg-subtle">{t('newIssue.noLabels')}</p>
                ) : (
                  <div
                    className="flex flex-wrap gap-1.5"
                    role="group"
                    aria-label={t('newIssue.labels')}
                  >
                    {metaData.labels.map((label) => {
                      const on = labels.includes(label.name)
                      return (
                        <button
                          key={label.name}
                          type="button"
                          aria-pressed={on}
                          title={label.description ?? undefined}
                          onClick={() =>
                            setLabels((prev) => toggle(prev, label.name, MAX_ISSUE_LABELS))
                          }
                          data-testid={`new-issue-label-${label.name}`}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-1 py-0.5',
                            on
                              ? 'border-accent'
                              : 'border-transparent opacity-70 hover:opacity-100',
                            focusRing
                          )}
                        >
                          {on && <Check size={12} aria-hidden className="text-accent" />}
                          <LabelChip label={{ name: label.name, color: label.color }} />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-fg-muted">{t('newIssue.assignees')}</span>
                {metaData.assignees.length === 0 ? (
                  <p className="text-xs text-fg-subtle">{t('newIssue.noAssignees')}</p>
                ) : (
                  <div
                    className="flex flex-wrap gap-1.5"
                    role="group"
                    aria-label={t('newIssue.assignees')}
                  >
                    {metaData.assignees.map((a) => {
                      const on = assignees.includes(a.login)
                      return (
                        <button
                          key={a.login}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setAssignees((prev) => toggle(prev, a.login, MAX_ISSUE_ASSIGNEES))
                          }
                          data-testid={`new-issue-assignee-${a.login}`}
                          className={cn(
                            'inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-xs',
                            on
                              ? 'border-accent bg-accent/10 text-fg'
                              : 'border-border text-fg-muted hover:text-fg',
                            focusRing
                          )}
                        >
                          <Avatar src={a.avatarUrl} name={a.login} size={16} />
                          {a.login}
                          {on && <Check size={12} aria-hidden className="text-accent" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {blocked && (
        <p className="text-xs text-warning" data-testid="new-issue-blocked">
          {t(blockedKey(blocked))}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger" data-testid="new-issue-error">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} disabled={creating} data-testid="new-issue-cancel">
          {t('newIssue.cancel')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!canSubmit}
          data-testid="new-issue-submit"
          data-creating={creating || undefined}
        >
          {creating ? t('newIssue.creating') : t('newIssue.create')}
        </Button>
      </div>
    </form>
  )
}
