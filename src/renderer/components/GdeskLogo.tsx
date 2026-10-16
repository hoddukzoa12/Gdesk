import { useId, type ComponentProps } from 'react'

export interface GdeskLogoProps extends Omit<ComponentProps<'svg'>, 'children'> {
  /** 픽셀 크기. 기본 22. */
  size?: number
}

/**
 * Gdesk 로고: 앱 아이콘(`build/icon.svg`)과 같은 모양(어두운 둥근 사각형 + 비스듬한 흰 획 두 개).
 * 앱 아이콘과 똑같아 보여야 하므로 테마와 관계없이 아이콘의 고정 색을 쓴다(테마 변수 예외).
 */
export function GdeskLogo({ size = 22, ...props }: GdeskLogoProps) {
  const gradientId = `gdesk-logo-bg-${useId()}`
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="100 100 824 824"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      {...props}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c1c1e" />
          <stop offset="1" stopColor="#0e0e10" />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="185" fill={`url(#${gradientId})`} />
      <rect
        x="101.5"
        y="101.5"
        width="821"
        height="821"
        rx="183.5"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.08"
        strokeWidth="3"
      />
      <g stroke="#ffffff" strokeWidth="122" strokeLinecap="round" fill="none">
        <line x1="352" y1="498" x2="548" y2="368" />
        <line x1="476" y1="656" x2="672" y2="526" />
      </g>
    </svg>
  )
}
