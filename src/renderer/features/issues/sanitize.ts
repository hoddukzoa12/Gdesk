import DOMPurify from 'dompurify'

/**
 * GitHub 가 만든 이슈 본문·코멘트·미리보기 HTML 을 화면에 넣기 전에 정리한다(spec §6.4).
 * DOMPurify 의 허용 목록에 더해 다음을 지운다.
 * - 요소: script, iframe, form, object, embed, style(내용째)
 * - 속성: style 전체, 모든 on* (DOMPurify 기본), javascript:·data: 링크(data: 는 이미지에만 허용)
 * - 체크박스가 아닌 input. 남는 체크박스(작업 목록)는 disabled 로 만들어 누를 수 없게 한다.
 * 이미지의 width·height·align 은 남긴다.
 */

const FORBID_TAGS = ['script', 'iframe', 'form', 'object', 'embed', 'style']
const FORBID_ATTR = ['style']

type Purifier = ReturnType<typeof DOMPurify>

let purifier: Purifier | null = null

/**
 * 이 정리 규칙 전용 DOMPurify 인스턴스. 훅은 인스턴스에 쌓이므로 처음 한 번만 만들고 단다.
 * 공용 기본 인스턴스(`DOMPurify.sanitize`)에는 훅을 달지 않는다(다른 코드에 새지 않게).
 */
function getPurifier(): Purifier {
  if (purifier) return purifier
  const instance = DOMPurify(window)
  instance.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName !== 'input') return
    const el = node as Element
    if ((el.getAttribute('type') ?? '').toLowerCase() !== 'checkbox') el.remove()
  })
  instance.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element
    if (el.tagName === 'INPUT') {
      el.setAttribute('disabled', '')
      return
    }
    // 링크: http(s) 가 아니면 주소를 지운다(data: 링크 등). 글자는 남는다
    if (el.tagName === 'A' && el.hasAttribute('href')) {
      const href = el.getAttribute('href') ?? ''
      if (/^\s*(data|javascript|vbscript):/i.test(href)) el.removeAttribute('href')
    }
  })
  purifier = instance
  return instance
}

export function sanitizeIssueHtml(html: string): string {
  if (!html) return ''
  return getPurifier().sanitize(html, {
    FORBID_TAGS,
    FORBID_ATTR,
    // SVG·MathML 은 쓰지 않는다
    USE_PROFILES: { html: true }
  })
}

/** 본문 안 링크를 브라우저로 열어도 되는가(http/https 절대 주소만) */
export function isExternalHref(href: string | null | undefined): href is string {
  if (!href) return false
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
