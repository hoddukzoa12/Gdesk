import { useState, type DragEvent, type KeyboardEvent } from 'react'
import { BookMarked, GripVertical, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { SidebarPinnedItem, SidebarQueryResult } from '@shared/domain/queries'
import '@shared/ipc/pins'
import { Badge, Button, SidebarItem, SidebarSection } from '@renderer/components'
import { cn } from '@renderer/lib/cn'
import { invoke } from '@renderer/lib/ipc'
import { moveItem } from './reorder'
import { RepoTrailing } from './RepoTrailing'
import { usePinsChangedRefresh, useSidebarData } from './useSidebarData'

/**
 * 사이드바 "Pinned" (spec §4.1, §3).
 * - 이름 · 스타 수 · 열린 PR 수(있을 때). 누르면 저장소 상세.
 * - 끌어서 순서 바꾸기(HTML5 끌어 놓기). 키보드는 Alt+↑/↓.
 * - 접근할 수 없게 된 저장소는 "사용할 수 없음" 과 제거 버튼. 자동으로 지우지 않는다.
 * - 아직 받지 못한 저장소(cached=false)는 흐린 `#<id>` 자리 표시.
 */
export function PinnedSection() {
  const { t } = useTranslation('sidebar')
  const { data } = useSidebarData()
  usePinsChangedRefresh()
  const client = useQueryClient()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)

  const pinned = data?.pinned ?? []

  const reorder = (from: number, to: number) => {
    const next = moveItem(pinned, from, to)
    if (next.every((p, i) => p.repoId === pinned[i]?.repoId)) return
    // 바로 보이게 캐시를 먼저 고치고, 응답·pins:changed 로 다시 읽는다
    client.setQueryData<SidebarQueryResult>(['query:sidebar'], (old) =>
      old ? { ...old, pinned: next.map((p, i) => ({ ...p, position: i })) } : old
    )
    invoke('pins:reorder', { repoIds: next.map((p) => p.repoId) }).catch(() => {
      void client.invalidateQueries({ queryKey: ['query:sidebar'] })
    })
  }

  const unpin = (repoId: number) => {
    void invoke('pins:unpin', { repoId }).finally(() => {
      void client.invalidateQueries({ queryKey: ['query:sidebar'] })
    })
  }

  const onDragStart = (e: DragEvent, repoId: number) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(repoId))
    setDragId(repoId)
  }
  const onDragOver = (e: DragEvent, repoId: number) => {
    if (dragId === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (overId !== repoId) setOverId(repoId)
  }
  const onDrop = (e: DragEvent, repoId: number) => {
    e.preventDefault()
    const from = pinned.findIndex((p) => p.repoId === dragId)
    const to = pinned.findIndex((p) => p.repoId === repoId)
    setDragId(null)
    setOverId(null)
    reorder(from, to)
  }
  const onDragEnd = () => {
    setDragId(null)
    setOverId(null)
  }
  const onKeyDown = (e: KeyboardEvent, index: number) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    const to = e.key === 'ArrowUp' ? index - 1 : index + 1
    reorder(index, to)
  }

  return (
    <SidebarSection title={t('pinned.title')}>
      <ul data-testid="sidebar-pinned" aria-label={t('pinned.title')}>
        {pinned.length === 0 && (
          <li className="px-4.5 py-1 text-[11px] text-fg-subtle" data-testid="sidebar-pinned-empty">
            {data ? t('pinned.empty') : null}
          </li>
        )}
        {pinned.map((item, index) => (
          <PinnedRow
            key={item.repoId}
            item={item}
            active={pathname === `/repos/${item.repoId}`}
            dragging={dragId === item.repoId}
            dropTarget={overId === item.repoId && dragId !== item.repoId}
            onOpen={() => void navigate(`/repos/${item.repoId}`)}
            onRemove={() => unpin(item.repoId)}
            onDragStart={(e) => onDragStart(e, item.repoId)}
            onDragOver={(e) => onDragOver(e, item.repoId)}
            onDrop={(e) => onDrop(e, item.repoId)}
            onDragEnd={onDragEnd}
            onKeyDown={(e) => onKeyDown(e, index)}
          />
        ))}
      </ul>
    </SidebarSection>
  )
}

interface PinnedRowProps {
  item: SidebarPinnedItem
  active: boolean
  dragging: boolean
  dropTarget: boolean
  onOpen: () => void
  onRemove: () => void
  onDragStart: (e: DragEvent) => void
  onDragOver: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
  onDragEnd: () => void
  onKeyDown: (e: KeyboardEvent) => void
}

function PinnedRow({
  item,
  active,
  dragging,
  dropTarget,
  onOpen,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onKeyDown
}: PinnedRowProps) {
  const { t } = useTranslation('sidebar')
  const notFetched = !item.cached
  const unavailable = item.cached && item.accessStatus === 'unavailable'
  const name = item.name ?? `#${item.repoId}`

  return (
    <li
      className={cn(
        'group relative flex items-center',
        dragging && 'opacity-50',
        dropTarget &&
          'before:absolute before:inset-x-3 before:-top-px before:h-0.5 before:bg-accent'
      )}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
      title={notFetched ? t('pinned.notFetched') : t('pinned.reorderHint')}
      data-testid={`pinned-row-${item.repoId}`}
      data-access={unavailable ? 'unavailable' : notFetched ? 'not_fetched' : 'available'}
    >
      <GripVertical
        size={11}
        aria-hidden
        className="pointer-events-none absolute left-0.5 text-fg-subtle opacity-0 group-hover:opacity-100"
      />
      <SidebarItem
        className={cn('min-w-0 flex-1', (unavailable || notFetched) && 'mr-0')}
        icon={<BookMarked size={13} aria-hidden />}
        label={<span className={cn((unavailable || notFetched) && 'text-fg-subtle')}>{name}</span>}
        trailing={
          unavailable ? (
            <Badge variant="warning" data-testid={`pinned-unavailable-${item.repoId}`}>
              {t('repo.unavailable')}
            </Badge>
          ) : notFetched ? null : (
            <RepoTrailing item={item} />
          )
        }
        active={active}
        onClick={onOpen}
      />
      {(unavailable || notFetched) && (
        <Button
          size="icon-sm"
          variant="ghost"
          className="mr-1.5"
          onClick={onRemove}
          aria-label={t('pinned.remove', { name })}
          title={t('pinned.remove', { name })}
          data-testid={`pinned-remove-${item.repoId}`}
        >
          <X />
        </Button>
      )}
    </li>
  )
}
