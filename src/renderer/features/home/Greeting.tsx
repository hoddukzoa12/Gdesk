import { useTranslation } from 'react-i18next'
import { Avatar, useNow } from '@renderer/components'
import { useSession } from '@renderer/lib/hooks/useSession'
import { greetingName, quoteIndexForDate } from './home-logic'

/** 인사말(늘 맨 위, 설정 대상 아님): 왼쪽 아바타·인사·부제, 오른쪽 오늘의 한마디. */
export function Greeting() {
  const { t } = useTranslation('home')
  const session = useSession()
  const user = session?.user ?? undefined
  // 날짜가 바뀌면 한마디도 바뀌도록 1분마다 다시 계산한다
  const now = useNow(60_000)
  const name = greetingName(user)
  const quote = t(`quotes.${quoteIndexForDate(new Date(now))}`)

  return (
    <div
      className="flex flex-wrap items-center gap-x-6 gap-y-3 px-1 pt-2 pb-1"
      data-testid="home-greeting"
    >
      <div className="flex min-w-0 items-center gap-5">
        {user && <Avatar src={user.avatarUrl} name={user.login} size={72} />}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-[26px] leading-tight font-semibold text-fg">
            {name ? t('greeting.hello', { name }) : t('greeting.helloAnonymous')}
          </h1>
          <p className="truncate text-[15px] text-fg-muted">{t('greeting.subtitle')}</p>
        </div>
      </div>
      <figure className="ml-auto max-w-sm text-right" aria-label={t('greeting.quoteLabel')}>
        <blockquote
          className="text-[15px] leading-snug text-fg-muted italic"
          data-testid="home-quote"
        >
          {t('greeting.quoted', { text: quote })}
        </blockquote>
      </figure>
    </div>
  )
}
