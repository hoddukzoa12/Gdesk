import { CircleCheck, CircleX, Minus, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'

/** CI 상태 값(spec 7). */
export type CiStatusValue = 'passing' | 'failing' | 'pending' | 'none'

export const CI_STATUS_VALUES: readonly CiStatusValue[] = ['passing', 'failing', 'pending', 'none']

export interface CiStatusMeta {
  /** 아이콘. `pending` 은 아이콘 대신 노란 점을 그린다. */
  icon: LucideIcon | null
  /** 글자색 토큰 클래스. */
  colorClass: string
  /** 배경색 토큰 클래스(막대·점 등). */
  bgClass: string
  /** 번역 키(`common` 네임스페이스). */
  labelKey: `ci.${CiStatusValue}`
}

/** CI 상태 → 표시 방식. 초록 체크 / 빨강 X / 노랑 점 / 회색. */
export const CI_STATUS_META: Record<CiStatusValue, CiStatusMeta> = {
  passing: {
    icon: CircleCheck,
    colorClass: 'text-success',
    bgClass: 'bg-success',
    labelKey: 'ci.passing'
  },
  failing: {
    icon: CircleX,
    colorClass: 'text-danger',
    bgClass: 'bg-danger',
    labelKey: 'ci.failing'
  },
  pending: {
    icon: null,
    colorClass: 'text-warning',
    bgClass: 'bg-warning',
    labelKey: 'ci.pending'
  },
  none: { icon: Minus, colorClass: 'text-neutral', bgClass: 'bg-neutral', labelKey: 'ci.none' }
}

export interface CiStatusIconProps {
  status: CiStatusValue
  /** 픽셀 크기. 기본 14. */
  size?: number
  className?: string
  /** 접근성 라벨. 기본은 상태 이름 번역. */
  label?: string
}

export function CiStatusIcon({ status, size = 14, className, label }: CiStatusIconProps) {
  const { t } = useTranslation('common')
  const meta = CI_STATUS_META[status]
  const text = label ?? t(meta.labelKey)
  const Icon = meta.icon
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      data-status={status}
      className={cn('inline-flex shrink-0 items-center justify-center', meta.colorClass, className)}
      style={{ width: size, height: size }}
    >
      {Icon ? (
        <Icon size={size} strokeWidth={2} aria-hidden />
      ) : (
        <span
          aria-hidden
          className={cn('rounded-full', meta.bgClass)}
          style={{ width: size * 0.5, height: size * 0.5 }}
        />
      )}
    </span>
  )
}
