import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import '@shared/ipc/auth'
import { Avatar, Button } from '@renderer/components'
import { invoke } from '@renderer/lib/ipc'
import { useSession } from '../auth/hooks'
import { ConfirmDialog, SettingsSection } from './ui'

/** 계정: 아바타·로그인 이름·로그인 방식, 확인 후 로그아웃. */
export function AccountSection() {
  const { t } = useTranslation('settings')
  const session = useSession()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const user = session?.user ?? null

  const signOut = async (): Promise<void> => {
    try {
      await invoke('auth:logout')
      setConfirmOpen(false)
    } catch {
      // 실패하면 대화상자를 그대로 두어 다시 시도할 수 있다
    }
  }

  return (
    <SettingsSection id="account" title={t('account.title')}>
      {user ? (
        <div className="flex items-center gap-3 px-4 py-3 text-[13px]">
          <Avatar src={user.avatarUrl || null} name={user.login} size={36} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-medium text-fg" data-testid="settings-account-login">
              {user.name ? `${user.name} (${user.login})` : user.login}
            </span>
            {session?.tokenKind && (
              <span className="text-xs text-fg-muted" data-testid="settings-account-token-kind">
                {t('account.tokenKind')}: {t(`account.tokenKinds.${session.tokenKind}`)}
              </span>
            )}
          </div>
          <Button onClick={() => setConfirmOpen(true)} data-testid="settings-sign-out">
            <LogOut aria-hidden />
            {t('account.signOut')}
          </Button>
        </div>
      ) : (
        <p className="px-4 py-3 text-[13px] text-fg-muted">{t('account.notSignedIn')}</p>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('account.signOutTitle')}
        description={t('account.signOutDescription')}
        cancelLabel={t('account.cancel')}
        confirmLabel={t('account.confirmSignOut')}
        onConfirm={signOut}
        testId="settings-sign-out-confirm"
      />
    </SettingsSection>
  )
}
