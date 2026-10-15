import type { ComponentProps, MouseEvent } from 'react'
import { ArrowUpRight } from 'lucide-react'
import '@shared/ipc/app'
import { invoke } from '../lib/ipc'
import { cn } from '../lib/cn'
import { focusRing } from './focus'

/** 주소를 메인 프로세스의 안전한 열기 함수로 기본 브라우저에서 연다(http/https 만 허용). */
export function openExternal(url: string): Promise<{ opened: boolean }> {
  return invoke('app:openExternal', { url })
}

export interface ExternalLinkProps extends Omit<ComponentProps<'a'>, 'href'> {
  href: string
  /** 오른쪽 위 화살표 아이콘. 기본 false. */
  showIcon?: boolean
}

/**
 * 외부 링크. 앱 창 안에서 이동하지 않고 기본 브라우저로 연다.
 * href 는 접근성과 주소 복사를 위해 그대로 둔다.
 */
export function ExternalLink({
  href,
  showIcon = false,
  className,
  children,
  onClick,
  ...props
}: ExternalLinkProps) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(e)
    e.preventDefault()
    void openExternal(href)
  }
  return (
    <a
      href={href}
      rel="noreferrer noopener"
      onClick={handleClick}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-sm text-fg-muted hover:text-fg hover:underline',
        focusRing,
        className
      )}
      {...props}
    >
      {children}
      {showIcon && <ArrowUpRight size={12} aria-hidden className="shrink-0" />}
    </a>
  )
}
