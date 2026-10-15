import { useId } from 'react'
import { cn } from '../lib/cn'

export interface SparklineProps {
  values: number[]
  /** 높이(px). 너비는 부모를 채운다. 기본 32. */
  height?: number
  /** 선 아래를 옅게 채운다. 기본 true. */
  area?: boolean
  /** 색 토큰 클래스(text-*). 기본 text-accent. */
  colorClass?: string
  /** 접근성 라벨. 없으면 장식으로 취급. */
  label?: string
  className?: string
}

const VIEW_W = 100

/** 값 배열을 0..100 × 0..h 좌표로 바꾼다. 값이 하나뿐이면 수평선. */
export function sparklinePoints(values: number[], h: number, pad = 1.5): Array<[number, number]> {
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = values.length > 1 ? VIEW_W / (values.length - 1) : 0
  return values.map((v, i) => {
    const x = values.length > 1 ? i * step : 0
    const y = max === min ? h / 2 : h - pad - ((v - min) / span) * (h - pad * 2)
    return [Number(x.toFixed(2)), Number(y.toFixed(2))]
  })
}

/** 30일 스타 추이 같은 작은 선 그래프. */
export function Sparkline({
  values,
  height = 32,
  area = true,
  colorClass = 'text-accent',
  label,
  className
}: SparklineProps) {
  const gradientId = useId()
  const pts = sparklinePoints(values.length === 1 ? [values[0]!, values[0]!] : values, height)
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ')
  const fill = pts.length ? `${line} L${VIEW_W},${height} L0,${height} Z` : ''
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      className={cn('block overflow-visible', colorClass, className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {area && pts.length > 0 && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={fill} fill={`url(#${gradientId})`} stroke="none" />
        </>
      )}
      {pts.length > 0 && (
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  )
}
