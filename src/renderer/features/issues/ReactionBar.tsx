import { useState } from 'react'
import { SmilePlus } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import '@shared/ipc/issue-actions'
import {
  REACTION_CONTENTS,
  type IssueRef,
  type ReactionContent,
  type ReactionGroup
} from '@shared/domain/issue-detail'
import { Button, focusRing } from '@renderer/components'
import { cn } from '@renderer/lib/cn'
import { invoke } from '@renderer/lib/ipc'
import { failureMessage } from './issues-logic'

/** GitHub 반응 8종의 그림 글자 */
export const REACTION_EMOJI: Record<ReactionContent, string> = {
  THUMBS_UP: '👍',
  THUMBS_DOWN: '👎',
  LAUGH: '😄',
  HOORAY: '🎉',
  CONFUSED: '😕',
  HEART: '❤️',
  ROCKET: '🚀',
  EYES: '👀'
}

export interface ReactionBarProps {
  /** 이슈 또는 코멘트의 노드 ID */
  subjectId: string
  issueRef: IssueRef
  reactions: readonly ReactionGroup[]
  /** GitHub 가 반응을 허락하는가(viewerCanReact). false 면 수만 보이고 버튼은 숨긴다 */
  canReact: boolean
  /** 쓰기가 막혀 있으면(오프라인 등) 버튼을 끈다 */
  disabled: boolean
  /** 실패 문구 알림(null 이면 지운다) */
  onError: (message: string | null) => void
  'data-testid'?: string
}

/**
 * 반응 줄(spec §6.2): 수가 1 이상인 반응과 수, 내 반응 강조. 웃는 얼굴 버튼으로 8종 선택.
 * 누르면 내 반응을 켜거나 끈다. 메인이 캐시를 먼저 바꾸고 data:changed 로 알리며, 실패하면 되돌린다.
 */
export function ReactionBar({
  subjectId,
  issueRef,
  reactions,
  canReact,
  disabled,
  onError,
  ...rest
}: ReactionBarProps) {
  const { t } = useTranslation('issues')
  const [pending, setPending] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const shown = REACTION_CONTENTS.map((content) =>
    reactions.find((r) => r.content === content)
  ).filter((r): r is ReactionGroup => r !== undefined && r.count > 0)

  const toggle = async (content: ReactionContent): Promise<void> => {
    if (pending || disabled || !canReact) return
    const current = reactions.find((r) => r.content === content)
    setPending(true)
    onError(null)
    try {
      const res = await invoke('issueActions:react', {
        subjectId,
        issueRef: { repoId: issueRef.repoId, number: issueRef.number },
        content,
        add: !(current?.viewerHasReacted ?? false)
      })
      if (!res.ok) onError(failureMessage(res, t))
    } catch {
      onError(t('failure.failed'))
    } finally {
      setPending(false)
    }
  }

  if (shown.length === 0 && !canReact) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5" {...rest}>
      {shown.map((r) => {
        const label = t('reactions.chip', {
          reaction: t(`reactions.names.${r.content}`),
          count: r.count
        })
        const cls = cn(
          'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs tabular-nums',
          r.viewerHasReacted
            ? 'border-reaction-active bg-reaction-active/15 text-reaction-active'
            : 'border-border bg-bg-subtle text-fg-muted'
        )
        const inner = (
          <>
            <span aria-hidden>{REACTION_EMOJI[r.content]}</span>
            {r.count}
          </>
        )
        return canReact ? (
          <button
            key={r.content}
            type="button"
            className={cn(cls, 'hover:border-border-strong disabled:opacity-50', focusRing)}
            aria-label={label}
            aria-pressed={r.viewerHasReacted}
            data-content={r.content}
            data-count={r.count}
            data-active={r.viewerHasReacted || undefined}
            disabled={disabled || pending}
            onClick={() => void toggle(r.content)}
          >
            {inner}
          </button>
        ) : (
          <span
            key={r.content}
            className={cls}
            role="img"
            aria-label={label}
            data-content={r.content}
            data-count={r.count}
            data-active={r.viewerHasReacted || undefined}
          >
            {inner}
          </span>
        )
      })}
      {canReact && (
        <Popover.Root open={pickerOpen} onOpenChange={setPickerOpen}>
          <Popover.Trigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('reactions.add')}
              title={t('reactions.add')}
              disabled={disabled || pending}
              data-testid="reaction-picker-button"
            >
              <SmilePlus />
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="top"
              align="start"
              sideOffset={6}
              className="z-50 flex gap-0.5 rounded-md border border-border bg-bg-elevated p-1 shadow-xl"
              data-testid="reaction-picker"
            >
              {REACTION_CONTENTS.map((content) => {
                const active = reactions.find((r) => r.content === content)?.viewerHasReacted
                return (
                  <button
                    key={content}
                    type="button"
                    className={cn(
                      'flex size-8 items-center justify-center rounded-md text-base hover:bg-bg-hover',
                      active && 'bg-reaction-active/15',
                      focusRing
                    )}
                    aria-label={t(`reactions.names.${content}`)}
                    aria-pressed={!!active}
                    data-testid={`reaction-option-${content}`}
                    onClick={() => {
                      setPickerOpen(false)
                      void toggle(content)
                    }}
                  >
                    <span aria-hidden>{REACTION_EMOJI[content]}</span>
                  </button>
                )
              })}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  )
}
