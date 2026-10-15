import type { RouteObject } from 'react-router'
import { RepoDetailPage } from './RepoDetailPage'

// 저장소 상세 화면: `#/repos/:repoId` (GitHub 숫자 저장소 ID)
export const routes: RouteObject[] = [{ path: 'repos/:repoId', element: <RepoDetailPage /> }]
