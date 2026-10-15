import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

/** 단축키 표시(⌘K 등). */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-bg-subtle px-1 font-sans text-[11px] leading-none text-fg-muted',
        className
      )}
      {...props}
    />
  )
}
