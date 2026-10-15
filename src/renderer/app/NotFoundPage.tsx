import { Compass } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { Button, EmptyState, PageHeader } from '../components'

/** 아직 없는 화면이나 알 수 없는 주소. */
export function NotFoundPage() {
  const { t } = useTranslation('common')
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <div data-testid="not-found-page">
      <PageHeader breadcrumb={[{ label: t('appName') }, { label: t('notFound.crumb') }]} />
      <EmptyState
        icon={<Compass />}
        title={t('notFound.title')}
        description={t('notFound.description', { path: location.pathname })}
        action={
          location.pathname !== '/home' && (
            <Button onClick={() => void navigate('/home')}>{t('notFound.goHome')}</Button>
          )
        }
        className="py-24"
      />
    </div>
  )
}
