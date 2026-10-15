import { useState, type ReactNode } from 'react'
import { AlertDialog, Switch as RadixSwitch } from 'radix-ui'
import { Button, focusRing, SectionCard } from '@renderer/components'
import { cn } from '@renderer/lib/cn'

// 설정 화면 안에서만 쓰는 작은 부품들.

export type SettingsSectionId =
  'account' | 'appearance' | 'clone' | 'home-cards' | 'folders' | 'about'

/** 주소 해시(#home-cards 등)로 찾아갈 수 있는 설정 묶음. */
export function SettingsSection({
  id,
  title,
  actions,
  children
}: {
  id: SettingsSectionId
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div id={id} className="scroll-mt-4" data-testid={`settings-section-${id}`}>
      <SectionCard title={title} actions={actions}>
        {children}
      </SectionCard>
    </div>
  )
}

/** 설정 한 줄: 왼쪽 이름·설명, 오른쪽 조작. */
export function SettingRow({
  label,
  hint,
  labelId,
  children,
  className
}: {
  label: ReactNode
  hint?: ReactNode
  /** 조작 요소의 aria-labelledby 대상 */
  labelId?: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 px-4 py-3 text-[13px] sm:flex-row sm:items-center sm:gap-4',
        className
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={labelId} className="font-medium text-fg">
          {label}
        </span>
        {hint && <span className="text-xs text-fg-muted">{hint}</span>}
      </div>
      {children !== undefined && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
}

/** 몇 개 중 하나를 고르는 버튼 묶음(radiogroup). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  labelledBy,
  testIdPrefix
}: {
  value: T | undefined
  options: ReadonlyArray<SegmentedOption<T>>
  onChange: (value: T) => void
  labelledBy: string
  testIdPrefix: string
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="inline-flex rounded-md border border-border bg-bg-subtle p-0.5"
    >
      {options.map((opt) => {
        const checked = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-testid={`${testIdPrefix}-${opt.value}`}
            onClick={() => {
              if (!checked) onChange(opt.value)
            }}
            className={cn(
              'h-6 rounded-[5px] px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
              focusRing,
              checked ? 'bg-bg-elevated text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/** 켜기·끄기 스위치. */
export function Toggle({
  checked,
  onCheckedChange,
  label,
  testId
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  testId?: string
}) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      data-testid={testId}
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-transparent transition-colors',
        focusRing,
        checked ? 'bg-accent' : 'bg-border-strong'
      )}
    >
      <RadixSwitch.Thumb
        className={cn(
          'block size-3 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-3.5' : 'translate-x-0.5'
        )}
      />
    </RadixSwitch.Root>
  )
}

/** 확인 대화상자. 확인 동작이 끝날 때까지 버튼을 끈다. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onConfirm,
  testId
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  cancelLabel: ReactNode
  confirmLabel: ReactNode
  onConfirm: () => Promise<void>
  testId: string
}) {
  const [busy, setBusy] = useState(false)
  const confirm = async (): Promise<void> => {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Content
          data-testid={testId}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2',
            'flex-col gap-3 rounded-lg border border-border bg-bg-elevated p-4 text-fg shadow-xl'
          )}
        >
          <AlertDialog.Title className="text-[15px] font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-[13px] break-words text-fg-muted">
            {description}
          </AlertDialog.Description>
          <div className="flex items-center justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button>{cancelLabel}</Button>
            </AlertDialog.Cancel>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void confirm()}
              data-testid={`${testId}-button`}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
