import { createContext, useContext, type ComponentType } from 'react'
import type { NavId } from './nav'
import type { Preferences } from './preferences'

export type { NavId } from './nav'

/** 순서가 있는 슬롯 항목. `order` 오름차순으로 그린다(같으면 모듈 경로 순). */
export interface OrderedSlot {
  order: number
  Component: ComponentType
}

/** 메뉴 옆 수치. 빠진 항목이나 0 은 배지를 그리지 않는다. */
export type NavCounts = Partial<Record<NavId, number>>

/** 설정 서비스가 테마·언어 값을 공급하는 통로(T18). PreferencesProvider 의 value/onChange 로 넘어간다. */
export interface PreferencesSource {
  value?: Partial<Preferences>
  onChange?: (next: Preferences) => void
}

/**
 * 기능 폴더의 `slots.tsx` 가 `export const slots: FeatureSlots = { ... }` 로 내보내는 모양.
 * 모든 항목은 선택이다. 앱 틀은 등록된 것만 그리고, 비어 있어도 깨지지 않는다.
 */
export interface FeatureSlots {
  /** 사이드바 맨 위 계정 영역(인증 작업). 여러 개면 모두 차례로 그린다. */
  sidebarTop?: ComponentType
  /** 메뉴 아래 사이드바 섹션(Pinned, Your repositories 등). */
  sidebarSections?: OrderedSlot[]
  /** 사이드바 하단(동기화 상태). 여러 개면 모두 차례로 그린다. */
  sidebarFooter?: ComponentType
  /** 본문 맨 위 배너(오프라인, 세션 만료 등). */
  banners?: OrderedSlot[]
  /** 루트에 한 번 그리는 요소(빠른 검색창, 대화상자 등). 라우터 안에서 그려진다. */
  overlays?: ComponentType[]
  /** 본문 상단 막대 오른쪽 끝의 전역 동작(검색 버튼 등). */
  headerActions?: OrderedSlot[]
  /**
   * 메뉴 수치 훅. 컴포넌트 안에서 훅으로 불리므로 다른 훅(useIpcQuery 등)을 써도 된다.
   * 여러 기능이 등록하면 결과를 합친다(뒤의 것이 같은 키를 덮어씀).
   */
  useNavCounts?: () => NavCounts
  /** 테마·언어 값 공급 훅(설정 작업). 여러 개면 첫 번째만 쓴다. undefined 를 돌려주면 기본값을 쓴다. */
  usePreferencesSource?: () => PreferencesSource | undefined
}

export interface FeatureSlotsModule {
  slots?: FeatureSlots
}

/** 모든 기능의 슬롯을 합친 결과. */
export interface ResolvedSlots {
  sidebarTop: ComponentType[]
  sidebarSections: ComponentType[]
  sidebarFooter: ComponentType[]
  banners: ComponentType[]
  overlays: ComponentType[]
  headerActions: ComponentType[]
  navCountHooks: Array<() => NavCounts>
  preferencesSource: (() => PreferencesSource | undefined) | undefined
}

function sortOrdered(items: OrderedSlot[]): ComponentType[] {
  // Array.prototype.sort 는 안정 정렬이라 같은 order 는 모듈 경로 순을 유지한다.
  return [...items].sort((a, b) => a.order - b.order).map((s) => s.Component)
}

/** 기능 모듈 묶음(경로 → 모듈)을 슬롯 목록으로 합친다. 순수 함수라 테스트에서 가짜 모듈로 부른다. */
export function collectSlots(modules: Record<string, FeatureSlotsModule>): ResolvedSlots {
  const list = Object.keys(modules)
    .sort()
    .map((key) => modules[key]?.slots)
    .filter((s): s is FeatureSlots => s !== undefined && s !== null)

  return {
    sidebarTop: list.flatMap((s) => (s.sidebarTop ? [s.sidebarTop] : [])),
    sidebarSections: sortOrdered(list.flatMap((s) => s.sidebarSections ?? [])),
    sidebarFooter: list.flatMap((s) => (s.sidebarFooter ? [s.sidebarFooter] : [])),
    banners: sortOrdered(list.flatMap((s) => s.banners ?? [])),
    overlays: list.flatMap((s) => s.overlays ?? []),
    headerActions: sortOrdered(list.flatMap((s) => s.headerActions ?? [])),
    navCountHooks: list.flatMap((s) => (s.useNavCounts ? [s.useNavCounts] : [])),
    preferencesSource: list.find((s) => s.usePreferencesSource)?.usePreferencesSource
  }
}

/**
 * 슬롯 자동 수집: `src/renderer/features/<기능>/slots.tsx` 가 `slots` 를 내보낸다.
 * 기능 작업은 앱 틀 파일을 고치지 않고 자기 slots.tsx 만 둔다.
 */
const modules = import.meta.glob<FeatureSlotsModule>('../features/*/slots.tsx', { eager: true })

export const registeredSlots: ResolvedSlots = collectSlots(modules)

export const SlotsContext = createContext<ResolvedSlots>(registeredSlots)
/** 테스트나 미리보기에서 슬롯을 바꿔 끼울 때 쓴다. */
export const SlotsProvider = SlotsContext.Provider

export function useSlots(): ResolvedSlots {
  return useContext(SlotsContext)
}

/**
 * 등록된 모든 메뉴 수치 훅을 불러 합친다.
 * 훅 목록은 모듈을 읽을 때 정해지고 바뀌지 않으므로 매 렌더 호출 순서가 같다.
 */
export function useNavCounts(hooks: Array<() => NavCounts>): NavCounts {
  const merged: NavCounts = {}
  for (const useHook of hooks) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- 목록이 고정이라 호출 순서가 바뀌지 않는다
    Object.assign(merged, useHook())
  }
  return merged
}
