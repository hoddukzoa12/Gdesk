import { Navigate, type RouteObject } from 'react-router'
import { AppLayout } from './AppLayout'
import { NotFoundPage } from './NotFoundPage'

/** 앱 틀 라우트: 레이아웃 + `/` → `/home` + 기능 라우트 + 알 수 없는 주소. 테스트도 이 함수를 쓴다. */
export function buildRoutes(featureRoutes: RouteObject[]): RouteObject[] {
  return [
    {
      path: '/',
      element: <AppLayout />,
      children: [
        { index: true, element: <Navigate to="/home" replace /> },
        ...featureRoutes,
        { path: '*', element: <NotFoundPage /> }
      ]
    }
  ]
}
