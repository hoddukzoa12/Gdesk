import type { RouteObject } from 'react-router'
import { AboutPage } from './AboutPage'

// 예시 기능 라우트. 다른 기능도 `features/<기능>/route.tsx` 에서 `routes` 를 내보낸다.
export const routes: RouteObject[] = [{ path: 'about', element: <AboutPage /> }]
