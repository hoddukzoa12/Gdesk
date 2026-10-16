import { useState, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import '@shared/ipc/issue-actions'
import type { IssueRef } from '@shared/domain/issue-detail'
import { Button } from '@renderer/components'
import { invoke } from '@renderer/lib/ipc'
import { failureMessage } from './issues-logic'
import { MarkdownEditor } from './MarkdownEditor'

export interface CommentComposerProps {
  issueRef: IssueRef
  /** GitHub 규칙상 댓글을 달 수 있는가(viewerCanComment) */
  canComment: boolean
  /** 쓰기가 막혀 있으면(오프라인 등) 보내기를 끈다 */
  disabled: boolean
  /** 댓글 버튼 옆 동작(닫기·다시 열기) */
  actions?: ReactNode
}

/**
 * 하단 댓글 입력(spec §6.3). 작성 / 미리보기, 보내는 동안·빈 글이면 버튼을 끈다.
 * 성공하면 입력을 비우고(새 댓글은 data:changed 로 다시 읽은 상세에 나온다), 실패하면 글을 그대로 둔다.
 */
export function CommentComposer({ issueRef, canComment, disabled, actions }: CommentComposerProps) {
  const { t } = useTranslation('issues')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canComment) {
    return (
      <div className="flex flex-col gap-2">
        <p
          className="flex items-center gap-2 rounded-md border border-border bg-bg-subtle px-3 py-2 text-[13px] text-fg-muted"
          data-testid="comment-locked-notice"
        >
          <Lock size={14} aria-hidden className="shrink-0" />
          {t('composer.cannotComment')}
        </p>
        {actions && <div className="flex justify-end gap-2">{actions}</div>}
      </div>
    )
  }

  const submit = async (): Promise<void> => {
    if (sending || disabled || text.trim() === '') return
    setSending(true)
    setError(null)
    try {
      const res = await invoke('issueActions:comment', {
        issueRef: { repoId: issueRef.repoId, number: issueRef.number },
        body: text
      })
      if (res.ok) setText('')
      else setError(failureMessage(res, t))
    } catch {
      setError(t('failure.failed'))
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-2"
      data-testid="comment-composer"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <MarkdownEditor
        repoId={issueRef.repoId}
        value={text}
        onChange={setText}
        placeholder={t('composer.placeholder')}
        label={t('composer.label')}
        disabled={sending}
        testIdPrefix="comment"
      />
      {error && (
        <p role="alert" className="text-[13px] text-danger" data-testid="comment-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {actions}
        <Button
          type="submit"
          variant="primary"
          disabled={sending || disabled || text.trim() === ''}
          data-testid="comment-submit"
          data-sending={sending || undefined}
        >
          {sending ? t('composer.sending') : t('composer.submit')}
        </Button>
      </div>
    </form>
  )
}
