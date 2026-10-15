import { Navigate, createHashRouter, type RouteObject } from 'react-router'
import { AppLayout } from './AppLayout'
import type { FeatureRouteModule } from './route-types'

/**
 * 기능 라우트 자동 수집: `src/renderer/features/<기능>/route.tsx` 가 `routes` 를 내보낸다.
 * 기능 작업은 이 파일을 고치지 않는다.
 */
const modules = import.meta.glob<FeatureRouteModule>('../features/*/route.tsx', { eager: true })
const featureRoutes: RouteObject[] = Object.values(modules).flatMap((m) => m.routes)

export const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [{ index: true, element: <Navigate to="/home" replace /> }, ...featureRoutes]
  }
])
