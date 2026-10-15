import { BookMarked } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Badge, SidebarItem, SidebarSection } from '@renderer/components'
import { RepoTrailing } from './RepoTrailing'
import { useSidebarData } from './useSidebarData'

/** 사이드바 "Your repositories": 내 저장소 일부(최근 푸시 순). 나머지는 Repositories 화면. */
export function YourRepositoriesSection() {
  const { t } = useTranslation('sidebar')
  const { data } = useSidebarData()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const items = data?.yourRepositories ?? []

  return (
    <SidebarSection title={t('yourRepositories.title')}>
      <ul data-testid="sidebar-your-repositories" aria-label={t('yourRepositories.title')}>
        {data && items.length === 0 && (
          <li className="px-4.5 py-1 text-[11px] text-fg-subtle">{t('yourRepositories.empty')}</li>
        )}
        {items.map((item) => (
          <li key={item.repoId} data-testid={`your-repo-row-${item.repoId}`}>
            <SidebarItem
              icon={<BookMarked size={13} aria-hidden />}
              label={item.name ?? `#${item.repoId}`}
              trailing={
                item.accessStatus === 'unavailable' ? (
                  <Badge variant="warning">{t('repo.unavailable')}</Badge>
                ) : (
                  <RepoTrailing item={item} />
                )
              }
              active={pathname === `/repos/${item.repoId}`}
              onClick={() => void navigate(`/repos/${item.repoId}`)}
            />
          </li>
        ))}
      </ul>
    </SidebarSection>
  )
}
