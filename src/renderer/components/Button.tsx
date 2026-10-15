import type { ComponentProps } from 'react'
import { Slot } from 'radix-ui'
import { cn } from '../lib/cn'
import { focusRing } from './focus'

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'icon' | 'icon-sm'

const variantClass: Record<ButtonVariant, string> = {
  default: 'border border-border bg-bg-subtle text-fg hover:bg-bg-hover hover:border-border-strong',
  primary: 'border border-transparent bg-accent text-accent-fg hover:brightness-110',
  ghost: 'border border-transparent bg-transparent text-fg-muted hover:bg-bg-hover hover:text-fg',
  danger: 'border border-border bg-bg-subtle text-danger hover:bg-danger hover:text-white'
}

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-6 gap-1 px-2 text-xs',
  md: 'h-7 gap-1.5 px-3 text-[13px]',
  icon: 'size-7 justify-center p-0',
  'icon-sm': 'size-6 justify-center p-0'
}

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** 자식 요소(예: Radix 트리거, 링크)에 버튼 모양을 입힌다. */
  asChild?: boolean
}

export function Button({
  variant = 'default',
  size = 'md',
  asChild = false,
  className,
  type,
  ...props
}: ButtonProps) {
  const classes = cn(
    'inline-flex shrink-0 items-center rounded-md font-medium whitespace-nowrap transition-colors',
    'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0',
    focusRing,
    variantClass[variant],
    sizeClass[size],
    className
  )
  if (asChild) return <Slot.Root className={classes} {...props} />
  return <button type={type ?? 'button'} className={classes} {...props} />
}
