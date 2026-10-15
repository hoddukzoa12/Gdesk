import type { ComponentProps } from 'react'
import { Tabs as TabsPrimitive } from 'radix-ui'
import { cn } from '../lib/cn'
import { focusRing } from './focus'

/** Radix 탭. 머리 막대 안에 TabsList 를 넣으려면 Tabs 로 페이지 전체를 감싼다. */
export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn('min-w-0', className)} {...props} />
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('inline-flex min-w-0 items-center gap-0.5', className)}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[13px] whitespace-nowrap text-fg-muted transition-colors',
        'hover:text-fg data-[state=active]:bg-bg-subtle data-[state=active]:text-fg',
        'disabled:pointer-events-none disabled:opacity-50',
        focusRing,
        className
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('outline-none', className)} {...props} />
}
