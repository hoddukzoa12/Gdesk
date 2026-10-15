import type { RouteObject } from 'react-router'
import { IssuesPage } from './IssuesPage'

export const routes: RouteObject[] = [{ path: 'issues', element: <IssuesPage /> }]
