import { useLayoutEffect, useMemo, useRef, type MouseEvent } from 'react'
import { openExternal } from '@renderer/components'
import { cn } from '@renderer/lib/cn'
import { isExternalHref, sanitizeIssueHtml } from './sanitize'
import './issueHtml.css'

export interface SafeHtmlProps {
  /** GitHub 가 만든 HTML(정리 전) */
  html: string
  /** 대체 문구가 없는 깨진 이미지 자리에 보일 글 */
  brokenImageLabel: string
  className?: string
  'data-testid'?: string
}

/** 깨진 이미지(만료된 비공개 이미지 주소 등)를 대체 문구로 바꾼다 */
function replaceWithAlt(img: HTMLImageElement, fallback: string): void {
  const span = document.createElement('span')
  span.className = 'issue-img-alt'
  span.textContent = img.getAttribute('alt') || fallback
  img.replaceWith(span)
}

/**
 * GitHub HTML 을 정리(sanitizeIssueHtml)한 뒤에만 넣는다. 정리하지 않은 HTML 은 절대 DOM 에 넣지 않는다.
 * 본문 안 링크는 앱 창에서 이동하지 않고, http(s) 면 기본 브라우저로 연다.
 */
export function SafeHtml({ html, brokenImageLabel, className, ...rest }: SafeHtmlProps) {
  const ref = useRef<HTMLDivElement>(null)
  const clean = useMemo(() => sanitizeIssueHtml(html), [html])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = clean
    const offs: Array<() => void> = []
    for (const img of Array.from(el.querySelectorAll('img'))) {
      const onError = (): void => replaceWithAlt(img, brokenImageLabel)
      img.addEventListener('error', onError, { once: true })
      offs.push(() => img.removeEventListener('error', onError))
    }
    return () => {
      for (const off of offs) off()
    }
  }, [clean, brokenImageLabel])

  const onClick = (e: MouseEvent<HTMLDivElement>): void => {
    const anchor = (e.target as Element | null)?.closest?.('a')
    if (!anchor || !e.currentTarget.contains(anchor)) return
    // 어떤 링크도 앱 창을 옮기지 않는다
    e.preventDefault()
    const href = anchor.getAttribute('href')
    if (isExternalHref(href)) void openExternal(href)
  }

  return (
    <div
      ref={ref}
      className={cn('issue-html', className)}
      onClick={onClick}
      onAuxClick={(e) => {
        if ((e.target as Element | null)?.closest?.('a')) e.preventDefault()
      }}
      {...rest}
    />
  )
}
