import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'
import { CI_STATUS_META, type CiStatusValue } from './CiStatusIcon'

export interface MiniBarsProps {
  /** 오래된 것부터 최근 순의 CI 상태(예: main 최근 7개 커밋). */
  statuses: CiStatusValue[]
  /** 접근성 라벨. 기본은 "통과 n · 실패 n ..." 요약. */
  label?: string
  className?: string
}

/** "CI on main, last 7 commits" 식의 작은 세로 막대 줄. */
export function MiniBars({ statuses, label, className }: MiniBarsProps) {
  const { t } = useTranslation('common')
  const summary =
    label ??
    (['passing', 'failing', 'pending', 'none'] as const)
      .map((s) => ({ s, n: statuses.filter((x) => x === s).length }))
      .filter(({ n }) => n > 0)
      .map(({ s, n }) => `${t(CI_STATUS_META[s].labelKey)} ${n}`)
      .join(' · ')
  return (
    <span
      role="img"
      aria-label={summary}
      className={cn('inline-flex items-end gap-[3px]', className)}
    >
      {statuses.map((s, i) => (
        <span
          key={i}
          data-status={s}
          className={cn('h-3.5 w-[5px] rounded-[1.5px]', CI_STATUS_META[s].bgClass)}
        />
      ))}
    </span>
  )
}
