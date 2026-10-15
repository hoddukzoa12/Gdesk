// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { RouterProvider, createMemoryRouter } from 'react-router'
import type { GdeskApi } from '@shared/ipc/contract'
import { PageHeader } from '../components'
import { i18n } from './i18n'
import { buildRoutes } from './routes'
import { SlotsProvider, collectSlots, type FeatureSlotsModule, type ResolvedSlots } from './slots'

// 예시 슬롯 모듈(실제 기능이 아님). 기능은 `features/<이름>/slots.tsx` 에서 같은 모양을 내보낸다.
const exampleModule: FeatureSlotsModule = {
  slots: {
    sidebarTop: () => <div data-testid="account">octocat</div>,
    sidebarSections: [
      { order: 20, Component: () => <section data-testid="section">Your repositories</section> },
      { order: 10, Component: () => <section data-testid="section">Pinned</section> }
    ],
    sidebarFooter: () => <div data-testid="footer">Synced 27s ago</div>,
    banners: [{ order: 1, Component: () => <div data-testid="banner">Offline</div> }],
    overlays: [() => <div data-testid="overlay">Palette</div>],
    headerActions: [{ order: 1, Component: () => <button type="button">Search</button> }],
    useNavCounts: () => {
      const [counts] = useState({ inbox: 3, pulls: 11, issues: 0 })
      return counts
    }
  }
}
const otherModule: FeatureSlotsModule = {
  slots: { useNavCounts: () => ({ reviews: 2, pulls: 12 }) }
}

function HomeStub() {
  return (
    <div data-testid="home">
      <PageHeader breadcrumb={[{ label: 'remocn' }, { label: 'remocn-studio' }]} />
    </div>
  )
}

function renderShell(slots: ResolvedSlots, path = '/home') {
  const router = createMemoryRouter(buildRoutes([{ path: 'home', element: <HomeStub /> }]), {
    initialEntries: [path]
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <SlotsProvider value={slots}>
          <RouterProvider router={router} />
        </SlotsProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

function stubPlatform(platform: 'darwin' | 'win32' | 'linux'): void {
  const api: GdeskApi = {
    invoke: (async () => ({
      name: 'Gdesk',
      version: '0.0.0',
      platform,
      testMode: true
    })) as unknown as GdeskApi['invoke'],
    on: () => () => {}
  }
  window.gdesk = api
}

beforeEach(async () => {
  stubPlatform('darwin')
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('collectSlots', () => {
  it('order 순으로 정렬하고 메뉴 수치 훅을 모은다', () => {
    const r = collectSlots({
      '../features/b/slots.tsx': otherModule,
      '../features/a/slots.tsx': exampleModule
    })
    expect(r.sidebarTop).toHaveLength(1)
    expect(r.sidebarSections).toEqual([
      exampleModule.slots!.sidebarSections![1]!.Component,
      exampleModule.slots!.sidebarSections![0]!.Component
    ])
    // 경로 순(a → b)
    expect(r.navCountHooks).toEqual([
      exampleModule.slots!.useNavCounts,
      otherModule.slots!.useNavCounts
    ])
    expect(r.preferencesSource).toBeUndefined()
  })

  it('slots 를 내보내지 않는 모듈은 무시한다', () => {
    const r = collectSlots({ '../features/x/slots.tsx': {} })
    expect(r.sidebarTop).toEqual([])
    expect(r.navCountHooks).toEqual([])
  })
})

describe('앱 틀 슬롯 렌더링', () => {
  it('등록된 슬롯을 모두 제자리에 그린다', async () => {
    renderShell(
      collectSlots({
        '../features/a/slots.tsx': exampleModule,
        '../features/b/slots.tsx': otherModule
      })
    )
    const sidebar = await screen.findByTestId('sidebar')
    expect(within(sidebar).getByTestId('account').textContent).toBe('octocat')
    expect(
      within(sidebar)
        .getAllByTestId('section')
        .map((s) => s.textContent)
    ).toEqual(['Pinned', 'Your repositories'])
    expect(within(sidebar).getByTestId('footer').textContent).toBe('Synced 27s ago')
    expect(screen.getByTestId('banner').textContent).toBe('Offline')
    expect(screen.getByTestId('overlay')).toBeTruthy()
    expect(
      within(screen.getByTestId('top-bar')).getByRole('button', { name: 'Search' })
    ).toBeTruthy()

    // 메뉴 수치: 합쳐지고(뒤가 덮어씀), 0 과 없는 항목은 배지 없음
    const link = (id: string) => sidebar.querySelector(`[data-nav="${id}"]`) as HTMLElement
    expect(link('inbox').textContent).toBe('Inbox3')
    expect(link('pulls').textContent).toBe('Pull requests12')
    expect(link('reviews').textContent).toBe('Review requests2')
    expect(link('issues').textContent).toBe('Issues')
    expect(link('home').textContent).toBe('Home')

    // 현재 화면 강조
    expect(link('home').getAttribute('aria-current')).toBe('page')
    expect(link('inbox').getAttribute('aria-current')).toBeNull()

    // PageHeader 는 상단 막대로 포털된다
    const topBar = screen.getByTestId('top-bar')
    expect(within(topBar).getByText('remocn-studio')).toBeTruthy()
  })

  it('슬롯이 비어 있어도 틀과 메뉴가 그려진다', async () => {
    renderShell(collectSlots({}))
    const sidebar = await screen.findByTestId('sidebar')
    expect(within(sidebar).getAllByRole('link')).toHaveLength(7)
    expect(document.querySelector('[data-slot]')).toBeNull()
    expect(screen.getByTestId('home')).toBeTruthy()
  })

  it('맥이면 신호등 자리만큼 상단을 비운다(app:info 의 platform)', async () => {
    renderShell(collectSlots({}))
    await waitFor(() => expect(screen.getByTestId('top-bar').className).toContain('h-11'))
  })

  it('맥이 아니면 상단을 비우지 않는다', async () => {
    stubPlatform('win32')
    renderShell(collectSlots({}))
    await waitFor(() => expect(screen.getByTestId('top-bar').className).toContain('h-10'))
  })

  it('알 수 없는 주소는 안내 화면을 보여 준다', async () => {
    renderShell(collectSlots({}), '/nowhere')
    expect(await screen.findByTestId('not-found-page')).toBeTruthy()
    expect(screen.getByText('Nothing is available at /nowhere.')).toBeTruthy()
  })

  it('한국어 메뉴', async () => {
    await i18n.changeLanguage('ko')
    renderShell(collectSlots({}))
    const sidebar = await screen.findByTestId('sidebar')
    expect(within(sidebar).getByRole('link', { name: '리뷰 요청' })).toBeTruthy()
    await i18n.changeLanguage('en')
  })
})
