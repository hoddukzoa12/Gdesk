import { useId, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import '@shared/ipc/auth'
import { Button, ExternalLink, focusRing } from '@renderer/components'
import { invoke } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/cn'
import { TOKEN_CREATE_URL, authErrorKey } from './messages'

interface TokenFormProps {
  autoFocus?: boolean
}

/**
 * 개인 토큰 직접 입력. 입력란은 제어하지 않는다(React 상태에 토큰을 두지 않는다).
 * 보내는 즉시 입력란을 비우므로 토큰은 메인으로 가는 요청 한 번에만 실린다.
 */
export function TokenForm({ autoFocus }: TokenFormProps) {
  const { t } = useTranslation('auth')
  const inputId = useId()
  const hintId = useId()
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    const input = inputRef.current
    if (!input || busy) return
    const token = input.value
    input.value = ''
    if (token.trim() === '') {
      setError('errors.emptyToken')
      input.focus()
      return
    }
    setError(null)
    setBusy(true)
    try {
      const res = await invoke('auth:loginWithToken', { token })
      if (!res.ok) setError(authErrorKey(res.error))
    } catch {
      setError('errors.httpError')
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  return (
    <section aria-labelledby={`${inputId}-title`} className="flex flex-col gap-3">
      <div>
        <h2 id={`${inputId}-title`} className="text-[13px] font-semibold">
          {t('token.title')}
        </h2>
        <p id={hintId} className="mt-0.5 text-xs text-fg-muted">
          {t('token.recommend')}{' '}
          {(['repo', 'read:org', 'notifications'] as const).map((scope, i) => (
            <span key={scope}>
              {i > 0 && ', '}
              <code className="rounded bg-bg-subtle px-1 font-mono text-[11px] text-fg">
                {scope}
              </code>
            </span>
          ))}
        </p>
      </div>

      <ExternalLink href={TOKEN_CREATE_URL} showIcon className="self-start text-xs text-accent">
        {t('token.createLink')}
      </ExternalLink>

      <form className="flex flex-col gap-2" onSubmit={(e) => void submit(e)} noValidate>
        <label htmlFor={inputId} className="text-xs font-medium text-fg-muted">
          {t('token.label')}
        </label>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            id={inputId}
            name="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoFocus={autoFocus}
            placeholder={t('token.placeholder')}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            aria-invalid={error ? true : undefined}
            data-testid="token-input"
            className={cn(
              'h-7 min-w-0 flex-1 rounded-md border border-border bg-bg-subtle px-2 font-mono text-[13px] text-fg',
              'placeholder:text-fg-subtle',
              focusRing
            )}
          />
          <Button type="submit" variant="primary" disabled={busy} data-testid="token-submit">
            {busy ? t('token.submitting') : t('token.submit')}
          </Button>
        </div>
        {error && (
          <p id={errorId} role="alert" className="text-xs text-danger" data-testid="token-error">
            {t(error)}
          </p>
        )}
      </form>

      <p className="text-xs text-fg-subtle">{t('token.fineGrainedNote')}</p>
    </section>
  )
}
