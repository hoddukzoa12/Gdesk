import { BookOpen, Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RepositoryDetail } from '@shared/domain/repo-detail'
import type { ContributorSummary, LanguageShare } from '@shared/domain/repo'
import { Avatar, Badge, EmptyState, ExternalLink, SectionCard } from '@renderer/components'
import { languageBars, repoLink } from './repo-detail'

/** 오른쪽 "About": 설명 · 홈페이지 · README · 토픽 */
export function AboutCard({ detail }: { detail: RepositoryDetail }) {
  const { t } = useTranslation('repo')
  const repo = detail.repository
  return (
    <SectionCard title={t('about.title')} flush={false}>
      <div className="flex flex-col gap-3 text-[13px]" data-testid="repo-about">
        <p className={repo.description ? 'text-fg' : 'text-fg-subtle'}>
          {repo.description ?? t('about.noDescription')}
        </p>
        <div className="flex flex-col gap-1.5">
          {repo.homepageUrl && (
            <ExternalLink href={repo.homepageUrl} className="min-w-0 text-accent">
              <Link2 size={13} aria-hidden className="mr-1 shrink-0" />
              <span className="truncate">{repo.homepageUrl.replace(/^https?:\/\//, '')}</span>
            </ExternalLink>
          )}
          <ExternalLink href={repoLink(repo.url, '#readme')}>
            <BookOpen size={13} aria-hidden className="mr-1 shrink-0" />
            {t('about.readme')}
          </ExternalLink>
        </div>
        {repo.topics.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={t('about.topics')}>
            {repo.topics.map((topic) => (
              <li key={topic}>
                <Badge variant="accent">{topic}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  )
}

/** 오른쪽 "Languages": 쌓인 비율 막대 + 상위 언어와 비율 */
export function LanguagesCard({ languages }: { languages: readonly LanguageShare[] }) {
  const { t } = useTranslation('repo')
  const items = languageBars(languages)
  return (
    <SectionCard title={t('languages.title')} flush={items.length === 0}>
      {items.length === 0 ? (
        <EmptyState compact title={t('languages.empty')} />
      ) : (
        <div className="flex flex-col gap-3" data-testid="repo-languages">
          <div
            role="img"
            aria-label={`${t('languages.bar')}: ${items
              .map((i) => `${i.name ?? t('languages.other')} ${i.label}`)
              .join(', ')}`}
            className="flex h-2 gap-px overflow-hidden rounded-full bg-bg-subtle"
          >
            {items.map((i) => (
              <span
                key={i.name ?? '__other'}
                className="h-full"
                style={{ width: `${i.percent}%`, backgroundColor: i.color, minWidth: 2 }}
              />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            {items.map((i) => (
              <li
                key={i.name ?? '__other'}
                className="flex items-center gap-1.5"
                data-testid="repo-language"
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: i.color }}
                />
                <span className="text-fg">{i.name ?? t('languages.other')}</span>
                <span className="text-fg-muted tabular-nums">{i.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  )
}

const MAX_CONTRIBUTORS = 20

/** 오른쪽 "Contributors": 아바타(최대 20) + 총 인원 */
export function ContributorsCard({
  contributors,
  total
}: {
  contributors: readonly ContributorSummary[]
  total: number | null
}) {
  const { t } = useTranslation('repo')
  const count = total ?? contributors.length
  const shown = contributors.slice(0, MAX_CONTRIBUTORS)
  const extra = count - shown.length
  return (
    <div data-testid="repo-contributors" data-count={count}>
      <SectionCard title={t('contributors.title')} count={count} flush={contributors.length === 0}>
        {contributors.length === 0 ? (
          <EmptyState compact title={t('contributors.empty')} />
        ) : (
          <ul className="flex flex-wrap items-center gap-1.5">
            {shown.map((c) => (
              <li key={c.login} title={c.login}>
                {c.url ? (
                  <ExternalLink href={c.url} aria-label={c.login} className="rounded-full">
                    <Avatar src={c.avatarUrl} name={c.login} size={24} />
                  </ExternalLink>
                ) : (
                  <Avatar src={c.avatarUrl} name={c.login} size={24} />
                )}
              </li>
            ))}
            {extra > 0 && (
              <li className="pl-1 text-xs text-fg-muted tabular-nums">
                {t('contributors.more', { n: extra })}
              </li>
            )}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}
