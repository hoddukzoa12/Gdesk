import { LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'

export interface SpinnerProps {
  /** 픽셀 크기. 기본 16. */
  size?: number
  /** 화면 읽기용 라벨. 기본 "불러오는 중". */
  label?: string
  className?: string
}

export function Spinner({ size = 16, label, className }: SpinnerProps) {
  const { t } = useTranslation('common')
  return (
    <span role="status" className={cn('inline-flex items-center text-fg-muted', className)}>
      <LoaderCircle size={size} className="animate-spin" aria-hidden />
      <span className="sr-only">{label ?? t('loading')}</span>
    </span>
  )
}
