import type { RouteObject } from 'react-router'
import { RepositoriesPage } from './RepositoriesPage'

export const routes: RouteObject[] = [{ path: 'repositories', element: <RepositoriesPage /> }]
