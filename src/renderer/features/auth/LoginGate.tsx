import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { usePlatform } from '@renderer/app/platform'
import { cn } from '@renderer/lib/cn'
import { useSession } from '@renderer/lib/hooks/useSession'
import { LoginScreen } from './LoginScreen'
import { isGateState } from './messages'

/**
 * 로그인 관문(오버레이 슬롯). 로그아웃·로그인 중이면 창 전체를 불투명하게 덮어 로그인 화면만 보이게 한다.
 * 앱 틀을 고치지 않으므로 뒤의 앱 틀 요소는 `inert` 로 막아 키보드 포커스·보조 기술에서 숨긴다.
 */
export function LoginGate() {
  const session = useSession()
  const active = isGateState(session?.state)
  if (!session || !active) return null
  return (
    <GateSurface>
      <LoginScreen session={session} />
    </GateSurface>
  )
}

function GateSurface({ children }: { children: ReactNode }) {
  const { t } = useTranslation('auth')
  const ref = useRef<HTMLDivElement>(null)
  const insetTitleBar = usePlatform() === 'darwin'

  useEffect(() => {
    const gate = ref.current
    const parent = gate?.parentElement
    if (!gate || !parent) return
    const hidden: Element[] = []
    for (const el of Array.from(parent.children)) {
      if (el === gate || el.hasAttribute('inert')) continue
      el.setAttribute('inert', '')
      hidden.push(el)
    }
    return () => {
      for (const el of hidden) el.removeAttribute('inert')
    }
  }, [])

  return (
    <div
      ref={ref}
      role="main"
      aria-label={t('login.title')}
      className="fixed inset-0 z-[1000] flex flex-col bg-bg text-fg"
      data-testid="login-screen"
    >
      <div className={cn('app-drag shrink-0', insetTitleBar ? 'h-11' : 'h-2')} aria-hidden />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
