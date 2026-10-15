import { useTranslation } from 'react-i18next'
import type { SessionSnapshot } from '@shared/domain/session'
import { DeviceFlowPanel } from './DeviceFlowPanel'
import { TokenForm } from './TokenForm'

interface LoginScreenProps {
  session: SessionSnapshot
}

/**
 * 로그인 화면(spec §5). 브라우저 코드 로그인은 빌드에 client ID 가 있을 때만 보이고,
 * 토큰 직접 입력은 언제나 보인다.
 */
export function LoginScreen({ session }: LoginScreenProps) {
  const { t } = useTranslation('auth')
  // 토큰 확인이 진행 중(기기 인증이 아닌 signing_in)이면 시작 버튼을 막는다
  const tokenCheckRunning = session.state === 'signing_in' && !session.deviceFlow

  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col gap-6 px-6 py-10">
      <header className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold text-fg">{t('login.title')}</h1>
        <p className="text-[13px] text-fg-muted">{t('login.subtitle')}</p>
      </header>

      <div className="flex flex-col gap-5 rounded-lg border border-border bg-bg-elevated p-5">
        {session.deviceFlowAvailable && (
          <>
            <DeviceFlowPanel flow={session.deviceFlow} disabled={tokenCheckRunning} />
            <div className="flex items-center gap-3 text-[11px] text-fg-subtle" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              {t('login.or')}
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}
        <TokenForm autoFocus={!session.deviceFlowAvailable} />
      </div>
    </div>
  )
}
