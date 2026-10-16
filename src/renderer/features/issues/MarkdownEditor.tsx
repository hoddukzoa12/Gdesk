import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import '@shared/ipc/issue-actions'
import { Spinner, Tabs, TabsList, TabsTrigger } from '@renderer/components'
import { cn } from '@renderer/lib/cn'
import { invoke } from '@renderer/lib/ipc'
import { failureMessage } from './issues-logic'
import { SafeHtml } from './SafeHtml'

type Mode = 'write' | 'preview'

type Preview =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; html: string }
  | { kind: 'error'; message: string }

export interface MarkdownEditorProps {
  /** 미리보기 저장소 문맥. null 이면 미리보기를 끈다 */
  repoId: number | null
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** 입력란 접근성 이름 */
  label: string
  disabled?: boolean
  /** 테스트 ID 앞머리(`<prefix>-input`, `<prefix>-write`, `<prefix>-preview`) */
  testIdPrefix: string
  rows?: number
}

/**
 * 마크다운 입력(작성 / 미리보기 탭). 미리보기는 GitHub 마크다운 변환(issueActions:previewMarkdown) 결과를
 * 본문과 같은 정리 규칙으로 보여 준다.
 */
export function MarkdownEditor({
  repoId,
  value,
  onChange,
  placeholder,
  label,
  disabled = false,
  testIdPrefix,
  rows = 4
}: MarkdownEditorProps) {
  const { t } = useTranslation('issues')
  const [mode, setMode] = useState<Mode>('write')
  const canPreview = mode === 'preview' && repoId !== null && value.trim() !== ''
  const previewQuery = useQuery({
    queryKey: ['issueActions:previewMarkdown', { repoId, text: value }],
    queryFn: () =>
      invoke('issueActions:previewMarkdown', { repoId: repoId as number, text: value }),
    enabled: canPreview,
    staleTime: 0,
    gcTime: 0
  })
  let preview: Preview
  if (!canPreview) preview = { kind: 'idle' }
  else if (previewQuery.isPending) preview = { kind: 'loading' }
  else if (previewQuery.isError) preview = { kind: 'error', message: t('failure.failed') }
  else if (previewQuery.data.ok) preview = { kind: 'ready', html: previewQuery.data.html }
  else preview = { kind: 'error', message: failureMessage(previewQuery.data, t) }

  return (
    <Tabs
      value={mode}
      onValueChange={(v) => setMode(v === 'preview' ? 'preview' : 'write')}
      className="flex flex-col gap-2"
    >
      <TabsList aria-label={t('editor.tabs')}>
        <TabsTrigger value="write" data-testid={`${testIdPrefix}-write`}>
          {t('editor.write')}
        </TabsTrigger>
        <TabsTrigger
          value="preview"
          data-testid={`${testIdPrefix}-preview`}
          disabled={repoId === null}
        >
          {t('editor.preview')}
        </TabsTrigger>
      </TabsList>
      {mode === 'write' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          rows={rows}
          disabled={disabled}
          data-testid={`${testIdPrefix}-input`}
          className={cn(
            'w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-[13px] text-fg',
            'placeholder:text-fg-subtle focus:border-border-strong focus:outline-none disabled:opacity-60'
          )}
        />
      ) : (
        <div
          className="min-h-20 rounded-md border border-border bg-bg px-3 py-2"
          data-testid={`${testIdPrefix}-preview-body`}
          data-preview={preview.kind}
        >
          {preview.kind === 'loading' && <Spinner />}
          {preview.kind === 'idle' && (
            <p className="text-[13px] text-fg-subtle">{t('editor.nothingToPreview')}</p>
          )}
          {preview.kind === 'error' && (
            <p role="alert" className="text-[13px] text-danger">
              {preview.message}
            </p>
          )}
          {preview.kind === 'ready' && (
            <SafeHtml html={preview.html} brokenImageLabel={t('detail.brokenImage')} />
          )}
        </div>
      )}
    </Tabs>
  )
}
