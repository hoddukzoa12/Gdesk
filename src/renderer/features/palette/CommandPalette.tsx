import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  BookMarked,
  ChevronRight,
  CircleDot,
  Download,
  GitPullRequest,
  Globe,
  Search
} from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { normalizeSearchText } from '@shared/domain/search'
import type { GitHubSearchResult, LocalSearchResult } from '@shared/domain/search'
import '@shared/ipc/queries'
import '@shared/ipc/search'
import '@shared/ipc/settings'
import '@shared/ipc/sync'
import { usePlatform } from '@renderer/app/platform'
import { usePreferences } from '@renderer/app/preferences'
import { Kbd, Spinner, openExternal } from '@renderer/components'
import { requestClone } from '@renderer/features/clone'
import { scopeForPathname } from '@renderer/features/sidebar/refreshScope'
import { useSyncStatus } from '@renderer/features/sidebar/useSyncStatus'
import { cn } from '@renderer/lib/cn'
import { invoke } from '@renderer/lib/ipc'
import { COMMANDS, filterCommands } from './commands'
import type { LabeledCommand, PaletteAction } from './commands'
import { buildCloneSection, buildSections, flattenItems, moveIndex } from './palette-logic'
import type {
  GitHubSectionState,
  PaletteItem,
  PaletteItemKind,
  PaletteSection
} from './palette-logic'
import { closePalette, isPaletteOpen, togglePalette, usePaletteOpen } from './store'

/** GitHub 검색 전 입력을 기다리는 시간(ms). spec §4.12 "지연값 조정 가능" */
export const GITHUB_SEARCH_DEBOUNCE_MS = 300

type Mode = 'default' | 'clone'

const LIST_ID = 'palette-list'
const optionId = (key: string) => `palette-option-${key}`

const KIND_ICON: Record<PaletteItemKind, ReactNode> = {
  command: <ChevronRight size={14} aria-hidden />,
  repo: <BookMarked size={14} aria-hidden />,
  pr: <GitPullRequest size={14} aria-hidden />,
  issue: <CircleDot size={14} aria-hidden />,
  github: <Globe size={14} aria-hidden />,
  clone: <Download size={14} aria-hidden />
}

/** 다른 대화상자(클론 등)가 열려 있으면 단축키로 검색창을 열지 않는다 */
function otherDialogOpen(): boolean {
  return Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).some(
    (el) => !el.closest('[data-testid="palette"]')
  )
}

/** ⌘K(맥) / Ctrl+K(그 밖) 로 연다·닫는다 */
function useShortcut(isMac: boolean): void {
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      // 한글 입력 상태에서는 key 가 'ㅏ' 로 오므로 물리 키(code)도 본다
      const isK = e.code === 'KeyK' || e.key.toLowerCase() === 'k'
      if (!isK || e.altKey || e.shiftKey) return
      const primary = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      if (!primary) return
      e.preventDefault()
      if (e.repeat) return
      // 처리기는 렌더 밖에서 불리므로 저장소 값을 바로 읽는다
      if (!isPaletteOpen() && otherDialogOpen()) return
      togglePalette()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isMac])
}

/** 앱 안 검색: 입력하는 즉시(오프라인에서도) */
function useLocalSearch(query: string | null): LocalSearchResult | null {
  const [result, setResult] = useState<{ query: string; data: LocalSearchResult } | null>(null)
  useEffect(() => {
    if (query === null) return
    let alive = true
    invoke('search:local', { text: query })
      .then((data) => {
        if (alive) setResult({ query, data })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [query])
  if (query === null) return null
  // 앞 검색어의 결과는 보이지 않는다(Enter 가 엉뚱한 항목을 열지 않게). 캐시 조회라 금방 온다
  return result !== null && result.query === query ? result.data : null
}

/** GitHub 저장소 검색: 입력이 멈추고 debounceMs 뒤, online 일 때만 */
function useGitHubSearch(
  query: string | null,
  offline: boolean,
  debounceMs: number
): GitHubSectionState {
  const [result, setResult] = useState<{ query: string; data: GitHubSearchResult } | null>(null)
  useEffect(() => {
    if (query === null || offline) return
    let alive = true
    const timer = setTimeout(() => {
      invoke('search:github', { text: query })
        .then((data) => {
          if (alive) setResult({ query, data })
        })
        .catch(() => {
          if (alive) setResult({ query, data: { status: 'error' } })
        })
    }, debounceMs)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query, offline, debounceMs])
  if (query === null) return { status: 'idle' }
  if (offline) return { status: 'offline' }
  if (result === null || result.query !== query) return { status: 'loading' }
  return result.data
}

export interface CommandPaletteProps {
  /** GitHub 검색 지연(ms). 기본 GITHUB_SEARCH_DEBOUNCE_MS */
  debounceMs?: number
}

/** 빠른 검색창(spec §4.12). 오버레이 슬롯에 한 번 그린다 */
export function CommandPalette({ debounceMs = GITHUB_SEARCH_DEBOUNCE_MS }: CommandPaletteProps) {
  const open = usePaletteOpen()
  const isMac = usePlatform() === 'darwin'
  useShortcut(isMac)
  if (!open) return null
  return <PaletteDialog debounceMs={debounceMs} />
}

function PaletteDialog({ debounceMs }: { debounceMs: number }) {
  const { t } = useTranslation('palette')
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { setTheme, setLanguage } = usePreferences()
  const sync = useSyncStatus()
  const offline = sync?.connection === 'offline'

  const [mode, setMode] = useState<Mode>('default')
  const [text, setText] = useState('')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const cloneRequested = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

  const query = normalizeSearchText(text)
  const local = useLocalSearch(query)
  const github = useGitHubSearch(mode === 'default' ? query : null, offline, debounceMs)
  const myRepos = useQuery({
    queryKey: ['query:repositories', { includeForks: true, includeArchived: true }],
    queryFn: () => invoke('query:repositories', { includeForks: true, includeArchived: true }),
    enabled: mode === 'clone'
  })

  const commands = useMemo<LabeledCommand[]>(
    () => COMMANDS.map((c) => ({ ...c, label: t(c.labelKey) })),
    [t]
  )

  const sections = useMemo<PaletteSection[]>(() => {
    if (mode === 'clone') {
      return [buildCloneSection(myRepos.data?.items ?? [], local?.repositories ?? [], text)]
    }
    return buildSections({ commands: filterCommands(commands, text), local, github })
  }, [mode, myRepos.data, local, text, commands, github])

  const items = useMemo(() => flattenItems(sections), [sections])
  const found = activeKey === null ? -1 : items.findIndex((i) => i.key === activeKey)
  const activeIndex = items.length === 0 ? -1 : found >= 0 ? found : 0
  const active = activeIndex >= 0 ? items[activeIndex] : undefined

  useEffect(() => {
    if (!active) return
    const el = document.getElementById(optionId(active.key))
    if (el && listRef.current?.contains(el)) el.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const changeText = (value: string) => {
    setText(value)
    setActiveKey(null)
  }

  const run = useCallback(
    (action: PaletteAction) => {
      switch (action.type) {
        case 'navigate':
          closePalette()
          void navigate(action.path)
          return
        case 'refresh':
          closePalette()
          void invoke('sync:refresh', { scope: scopeForPathname(pathname) }).catch(() => undefined)
          return
        case 'cloneMode':
          setMode('clone')
          setText('')
          setActiveKey(null)
          return
        case 'theme':
          closePalette()
          setTheme(action.value)
          void invoke('settings:update', { theme: action.value }).catch(() => undefined)
          return
        case 'language':
          closePalette()
          setLanguage(action.value)
          void invoke('settings:update', { language: action.value }).catch(() => undefined)
          return
        case 'external':
          closePalette()
          void openExternal(action.url).catch(() => undefined)
          return
        case 'clone':
          // 클론 중에 다시 부르면 진행 중인 클론이 취소되므로 한 번만 부른다
          if (cloneRequested.current) return
          cloneRequested.current = true
          closePalette()
          requestClone(action.target)
          return
      }
    },
    [navigate, pathname, setTheme, setLanguage]
  )

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 한글 조합 중의 Enter·화살표는 입력기 몫이다
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = moveIndex(activeIndex, e.key === 'ArrowDown' ? 1 : -1, items.length)
      setActiveKey(next >= 0 ? (items[next]?.key ?? null) : null)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!e.repeat && active) run(active.action)
    } else if (e.key === 'Backspace' && mode === 'clone' && text === '') {
      e.preventDefault()
      setMode('default')
      setActiveKey(null)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(next) => !next && closePalette()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          data-testid="palette"
          data-mode={mode}
          aria-describedby={undefined}
          className={cn(
            'fixed top-[12vh] left-1/2 z-50 flex max-h-[70vh] w-[min(640px,calc(100vw-32px))]',
            '-translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border-strong',
            'bg-bg-elevated text-fg shadow-2xl focus:outline-none'
          )}
        >
          <Dialog.Title className="sr-only">{t('title')}</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            {mode === 'clone' ? (
              <button
                type="button"
                className="rounded p-1 text-fg-muted hover:bg-bg-hover hover:text-fg"
                aria-label={t('clone.back')}
                data-testid="palette-back"
                onClick={() => {
                  setMode('default')
                  setText('')
                  setActiveKey(null)
                }}
              >
                <ArrowLeft size={14} aria-hidden />
              </button>
            ) : (
              <Search size={15} aria-hidden className="shrink-0 text-fg-subtle" />
            )}
            <input
              data-testid="palette-input"
              role="combobox"
              aria-expanded
              aria-controls={LIST_ID}
              aria-autocomplete="list"
              aria-activedescendant={active ? optionId(active.key) : undefined}
              aria-label={mode === 'clone' ? t('clone.placeholder') : t('placeholder')}
              placeholder={mode === 'clone' ? t('clone.placeholder') : t('placeholder')}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              value={text}
              onChange={(e) => changeText(e.target.value)}
              onKeyDown={onKeyDown}
              className="h-11 min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-subtle"
            />
            {mode === 'clone' && (
              <span className="shrink-0 text-xs text-fg-muted">{t('clone.title')}</span>
            )}
          </div>
          <div
            ref={listRef}
            id={LIST_ID}
            role="listbox"
            aria-label={t('results')}
            className="min-h-0 flex-1 overflow-y-auto py-1"
          >
            {sections.map((section) => (
              <Section
                key={section.id}
                section={section}
                activeKey={active?.key ?? null}
                onHover={setActiveKey}
                onPick={(item) => run(item.action)}
              />
            ))}
            {sections.length === 0 && (
              <p className="px-4 py-6 text-center text-[13px] text-fg-muted">{t('noResults')}</p>
            )}
          </div>
          <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-fg-subtle">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              {t('footer.move')}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd>
              {t('footer.open')}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Esc</Kbd>
              {t('footer.close')}
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

interface SectionProps {
  section: PaletteSection
  activeKey: string | null
  onHover: (key: string) => void
  onPick: (item: PaletteItem) => void
}

function Section({ section, activeKey, onHover, onPick }: SectionProps) {
  const { t } = useTranslation('palette')
  const headingId = `palette-section-${section.id}`
  return (
    <div role="group" aria-labelledby={headingId} data-testid={`palette-section-${section.id}`}>
      <div
        id={headingId}
        className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase"
      >
        {t(`sections.${section.id}`)}
      </div>
      {section.note && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-fg-muted"
          data-testid={`palette-note-${section.id}`}
          data-note={section.note}
        >
          {section.note === 'loading' && <Spinner size={12} />}
          {t(`notes.${section.id === 'clone' ? 'cloneEmpty' : section.note}`)}
        </div>
      )}
      {section.items.map((item) => {
        const selected = item.key === activeKey
        return (
          <div
            key={item.key}
            id={optionId(item.key)}
            role="option"
            aria-selected={selected}
            data-key={item.key}
            data-testid={`palette-item-${item.key}`}
            onMouseMove={() => !selected && onHover(item.key)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(item)}
            className={cn(
              'mx-1 flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px]',
              selected ? 'bg-bg-hover text-fg' : 'text-fg'
            )}
          >
            <span className="shrink-0 text-fg-muted">{KIND_ICON[item.kind]}</span>
            <span className="min-w-0 flex-1 truncate">
              {item.title}
              {item.subtitle && (
                <span className="ml-2 text-xs text-fg-subtle">{item.subtitle}</span>
              )}
            </span>
            {item.hint && <span className="shrink-0 text-xs text-fg-subtle">{item.hint}</span>}
          </div>
        )
      })}
    </div>
  )
}
