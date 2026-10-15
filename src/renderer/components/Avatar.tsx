import { useState, type ComponentProps } from 'react'
import { cn } from '../lib/cn'

export interface AvatarProps extends Omit<ComponentProps<'span'>, 'children'> {
  src?: string | null
  /** 대체 텍스트이자 이미지가 없을 때 첫 글자를 보여 줄 이름(로그인 등). */
  name: string
  /** 픽셀 크기. 기본 20. */
  size?: number
  /** 조직·봇 등은 둥근 사각형. 기본 원. */
  shape?: 'circle' | 'square'
}

/** 사용자·조직 아바타. 이미지를 못 읽으면 이름 첫 글자를 보여 준다. */
export function Avatar({
  src,
  name,
  size = 20,
  shape = 'circle',
  className,
  style,
  ...props
}: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = !!src && failedSrc !== src
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden bg-bg-subtle font-medium text-fg-muted select-none',
        shape === 'circle' ? 'rounded-full' : 'rounded-md',
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.45)),
        ...style
      }}
      {...props}
    >
      {showImage ? (
        <img
          src={src}
          alt={name}
          width={size}
          height={size}
          className="size-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span role="img" aria-label={name}>
          {name.trim().charAt(0).toUpperCase() || '?'}
        </span>
      )}
    </span>
  )
}
