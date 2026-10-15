import type { ReactNode } from 'react'
import { CircleAlert, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { EmptyState } from './EmptyState'

export interface ErrorStateProps {
  /** 기본은 "문제가 생겼습니다" 번역. */
  title?: ReactNode
  /** 사용자에게 보여 줄 설명. */
  message?: ReactNode
  /** 주어지면 "다시 시도" 버튼을 그린다. */
  onRetry?: () => void
  /** 추가 동작(예: 오류 보고 버튼). */
  action?: ReactNode
  className?: string
}

/** 불러오기 실패 등 오류 안내. */
export function ErrorState({ title, message, onRetry, action, className }: ErrorStateProps) {
  const { t } = useTranslation('common')
  return (
    <div role="alert" className={className}>
      <EmptyState
        icon={<CircleAlert className="text-danger" />}
        title={title ?? t('error.title')}
        description={message}
        action={
          (onRetry || action) && (
            <div className="flex items-center gap-2">
              {onRetry && (
                <Button onClick={onRetry}>
                  <RefreshCw />
                  {t('actions.retry')}
                </Button>
              )}
              {action}
            </div>
          )
        }
      />
    </div>
  )
}
