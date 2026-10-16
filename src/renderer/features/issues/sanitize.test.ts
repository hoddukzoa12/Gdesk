// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isExternalHref, sanitizeIssueHtml } from './sanitize'

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** 정리한 HTML 을 DOM 으로 풀어 검사한다 */
function parse(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = sanitizeIssueHtml(html)
  return root
}

describe('sanitizeIssueHtml: 지우는 것', () => {
  const removed: Array<{ name: string; html: string; check: (root: HTMLElement) => void }> = [
    {
      name: '<script>',
      html: '<p>a</p><script>window.__x = 1</script>',
      check: (root) => {
        expect(root.querySelector('script')).toBeNull()
        expect(root.innerHTML).not.toContain('__x')
      }
    },
    {
      name: '<img onerror>',
      html: '<img src="x" onerror="window.__x = 1" alt="broken">',
      check: (root) => {
        const img = root.querySelector('img')
        expect(img).not.toBeNull()
        expect(img?.getAttribute('onerror')).toBeNull()
        expect(img?.getAttribute('alt')).toBe('broken')
      }
    },
    {
      name: '모든 on* 속성',
      html: '<p onclick="x()" onmouseover="y()">a</p><a href="https://x.dev" onfocus="z()">b</a>',
      check: (root) => {
        for (const el of Array.from(root.querySelectorAll('*'))) {
          for (const attr of Array.from(el.attributes)) {
            expect(attr.name.startsWith('on')).toBe(false)
          }
        }
      }
    },
    {
      name: '<a href="javascript:">',
      html: '<a href="javascript:window.__x=1">click</a><a href="JaVaScRiPt:alert(1)">b</a>',
      check: (root) => {
        for (const a of Array.from(root.querySelectorAll('a'))) {
          expect(a.getAttribute('href')).toBeNull()
        }
        expect(root.textContent).toContain('click')
      }
    },
    {
      name: '<a href="data:">',
      html: '<a href="data:text/html;base64,PHNjcmlwdD4=">data link</a>',
      check: (root) => {
        expect(root.querySelector('a')?.getAttribute('href')).toBeNull()
      }
    },
    {
      name: '<iframe>',
      html: '<iframe src="https://evil.example"></iframe><p>after</p>',
      check: (root) => {
        expect(root.querySelector('iframe')).toBeNull()
        expect(root.textContent).toContain('after')
      }
    },
    {
      name: '<form>',
      html: '<form action="https://evil.example"><button>go</button></form>',
      check: (root) => {
        expect(root.querySelector('form')).toBeNull()
      }
    },
    {
      name: '<object>·<embed>',
      html: '<object data="x.swf"></object><embed src="x.swf">',
      check: (root) => {
        expect(root.querySelector('object')).toBeNull()
        expect(root.querySelector('embed')).toBeNull()
      }
    },
    {
      name: '<style> 요소',
      html: '<style>body{display:none}</style><p>a</p>',
      check: (root) => {
        expect(root.querySelector('style')).toBeNull()
        expect(root.innerHTML).not.toContain('display:none')
      }
    },
    {
      name: 'style 속성',
      html: '<p style="position:fixed;inset:0">a</p><img src="https://x.githubusercontent.com/a.png" style="width:9999px">',
      check: (root) => {
        expect(root.querySelector('[style]')).toBeNull()
      }
    }
  ]

  it.each(removed)('$name', ({ html, check }) => {
    check(parse(html))
  })
})

describe('sanitizeIssueHtml: 남기는 것', () => {
  it('data: 이미지와 width·height·align', () => {
    const root = parse(`<img src="${PIXEL}" alt="shot" width="10" height="20" align="right">`)
    const img = root.querySelector('img')
    expect(img?.getAttribute('src')).toBe(PIXEL)
    expect(img?.getAttribute('width')).toBe('10')
    expect(img?.getAttribute('height')).toBe('20')
    expect(img?.getAttribute('align')).toBe('right')
  })

  it('https 링크·코드 블록·표·목록', () => {
    const root = parse(
      [
        '<p><a href="https://docs.github.com/rest">docs</a></p>',
        '<pre><code class="language-ts">const a = 1</code></pre>',
        '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>',
        '<ul><li>one</li></ul><h2>Title</h2>'
      ].join('')
    )
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://docs.github.com/rest')
    expect(root.querySelector('pre code')?.textContent).toBe('const a = 1')
    expect(root.querySelector('table td')?.textContent).toBe('c')
    expect(root.querySelector('ul li')).not.toBeNull()
    expect(root.querySelector('h2')).not.toBeNull()
  })

  it('작업 목록 체크박스는 누를 수 없게 한다', () => {
    const root = parse(
      '<ul><li><input type="checkbox" class="task-list-item-checkbox"> a</li>' +
        '<li><input type="checkbox" checked> b</li></ul>'
    )
    const boxes = Array.from(root.querySelectorAll('input'))
    expect(boxes).toHaveLength(2)
    for (const box of boxes) expect(box.hasAttribute('disabled')).toBe(true)
    expect(boxes[1]?.hasAttribute('checked')).toBe(true)
  })

  it('체크박스가 아닌 input 은 지운다', () => {
    const root = parse('<input type="text" value="x"><input type="password">')
    expect(root.querySelector('input')).toBeNull()
  })

  it('빈 입력', () => {
    expect(sanitizeIssueHtml('')).toBe('')
  })
})

describe('isExternalHref', () => {
  it.each([
    ['https://github.com/a', true],
    ['http://example.com', true],
    ['javascript:alert(1)', false],
    ['data:text/html,x', false],
    ['file:///etc/passwd', false],
    ['#anchor', false],
    ['/relative', false],
    ['', false]
  ])('%s → %s', (href, expected) => {
    expect(isExternalHref(href)).toBe(expected)
  })
})
