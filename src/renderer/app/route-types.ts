import type { RouteObject } from 'react-router'

/** 기능 폴더의 `route.tsx` 가 내보내는 모양. `path` 는 `/` 없이 시작하는 상대 경로(예: `home`). */
export interface FeatureRouteModule {
  routes: RouteObject[]
}
