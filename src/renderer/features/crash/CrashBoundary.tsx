import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorState } from '@renderer/components'
import { reportRendererError, toRendererError } from './capture'

export interface CrashBoundaryProps {
  children: ReactNode
  /** 기본은 "다시 시도" 버튼이 있는 오류 안내 */
  fallback?: (reset: () => void) => ReactNode
}

interface State {
  failed: boolean
}

function DefaultFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('crash')
  return (
    <ErrorState title={t('boundary.title')} message={t('boundary.message')} onRetry={onRetry} />
  )
}

/**
 * 렌더 중 오류를 잡아 메인에 보고하고(crash:reportRenderer) 대체 화면을 그린다.
 * 앱 틀이 본문을 감쌀 때 쓴다. 보고 대화상자는 CrashDialog 오버레이가 띄운다.
 */
export class CrashBoundary extends Component<CrashBoundaryProps, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const input = toRendererError(error)
    const componentStack = info.componentStack?.trim()
    reportRendererError({
      message: input.message,
      stack: [input.stack, componentStack].filter(Boolean).join('\n\nComponent stack:\n') || null
    })
  }

  private reset = (): void => {
    this.setState({ failed: false })
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return this.props.fallback ? (
      this.props.fallback(this.reset)
    ) : (
      <DefaultFallback onRetry={this.reset} />
    )
  }
}
