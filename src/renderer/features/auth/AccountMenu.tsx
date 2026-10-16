import { useState } from 'react'
import { ChevronDown, ExternalLink as ExternalIcon, LogOut, Settings } from 'lucide-react'
import { AlertDialog, DropdownMenu } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import '@shared/ipc/auth'
import { Avatar, Button, focusRing, openExternal } from '@renderer/components'
import { invoke } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/cn'
import { useSession } from '@renderer/lib/hooks/useSession'
import { accountLines, profileUrl } from './messages'

const itemClass = cn(
  'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-[13px] text-fg outline-none select-none',
  'data-[highlighted]:bg-bg-hover [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-muted'
)

/**
 * 사이드바 맨 아래 계정 영역(spec §4.1): 아바타·이름·공개 이메일.
 * 누르면 위로 열리는 메뉴(설정·GitHub 프로필·로그아웃(확인)).
 */
export function AccountMenu() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const session = useSession()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const user = session?.user
  if (!user) return null
  const { primary, secondary } = accountLines(user)

  const signOut = async (): Promise<void> => {
    setBusy(true)
    try {
      await invoke('auth:logout')
      setConfirmOpen(false)
    } catch {
      // 실패하면 대화상자를 그대로 두어 다시 시도할 수 있다
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          className={cn(
            'mx-1.5 flex w-[calc(100%-12px)] items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
            'transition-colors hover:bg-bg-hover data-[state=open]:bg-bg-hover',
            focusRing
          )}
          aria-label={t('account.menuLabel', { login: user.login })}
          data-testid="account-menu-trigger"
        >
          <Avatar src={user.avatarUrl || null} name={user.login} size={28} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span
              className="truncate text-[13px] leading-[18px] font-medium text-fg"
              data-testid="account-name"
            >
              {primary}
            </span>
            <span
              className="truncate text-[11px] leading-4 text-fg-muted"
              data-testid="account-email"
            >
              {secondary}
            </span>
          </span>
          <ChevronDown size={14} aria-hidden className="shrink-0 text-fg-subtle" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="top"
            align="start"
            sideOffset={6}
            className="z-50 w-(--radix-dropdown-menu-trigger-width) min-w-[200px] rounded-md border border-border bg-bg-elevated p-1 text-fg shadow-xl"
            data-testid="account-menu"
          >
            <DropdownMenu.Item
              className={itemClass}
              onSelect={() => void navigate('/settings')}
              data-testid="account-menu-settings"
            >
              <Settings aria-hidden />
              {t('account.settings')}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={itemClass}
              onSelect={() => void openExternal(profileUrl(user.login))}
              data-testid="account-menu-profile"
            >
              <ExternalIcon aria-hidden />
              {t('account.profile')}
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item
              className={itemClass}
              onSelect={() => setConfirmOpen(true)}
              data-testid="account-menu-sign-out"
            >
              <LogOut aria-hidden />
              {t('account.signOut')}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <AlertDialog.Content
            data-testid="sign-out-confirm"
            className={cn(
              'fixed top-1/2 left-1/2 z-50 flex w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2',
              'flex-col gap-3 rounded-lg border border-border bg-bg-elevated p-4 text-fg shadow-xl'
            )}
          >
            <AlertDialog.Title className="text-[15px] font-semibold">
              {t('signOut.title')}
            </AlertDialog.Title>
            <AlertDialog.Description className="text-[13px] text-fg-muted">
              {t('signOut.description')}
            </AlertDialog.Description>
            <div className="flex items-center justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button>{t('signOut.cancel')}</Button>
              </AlertDialog.Cancel>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void signOut()}
                data-testid="sign-out-confirm-button"
              >
                {t('signOut.confirm')}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  )
}
