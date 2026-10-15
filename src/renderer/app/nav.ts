import {
  BookMarked,
  CircleDot,
  GitPullRequest,
  House,
  Inbox,
  MessageSquareCode,
  Star,
  type LucideIcon
} from 'lucide-react'

export const NAV_IDS = [
  'home',
  'inbox',
  'pulls',
  'reviews',
  'issues',
  'starred',
  'repositories'
] as const
/** 사이드바 메뉴 항목 ID. 번역 키는 `common:nav.<id>`. */
export type NavId = (typeof NAV_IDS)[number]

export interface NavItem {
  id: NavId
  path: string
  icon: LucideIcon
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'home', path: '/home', icon: House },
  { id: 'inbox', path: '/inbox', icon: Inbox },
  { id: 'pulls', path: '/pulls', icon: GitPullRequest },
  { id: 'reviews', path: '/reviews', icon: MessageSquareCode },
  { id: 'issues', path: '/issues', icon: CircleDot },
  { id: 'starred', path: '/starred', icon: Star },
  { id: 'repositories', path: '/repositories', icon: BookMarked }
]
