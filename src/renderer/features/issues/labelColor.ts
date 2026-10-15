/**
 * GitHub 라벨 색으로 칩 색을 정한다. 배경은 라벨 색 그대로, 글자는 검정·흰색 중 대비가 큰 쪽.
 * 검정·흰색 중 큰 쪽의 대비는 어떤 배경에서도 4.5:1(WCAG AA 본문) 이상이다.
 */

export interface LabelChipColors {
  background: string
  foreground: string
}

type Rgb = readonly [number, number, number]

const DARK: Rgb = [0, 0, 0]
const LIGHT: Rgb = [255, 255, 255]

/** `d73a4a` 또는 `#d73a4a` → RGB. 6자리 16진수가 아니면 null */
export function parseHexColor(color: string | null | undefined): Rgb | null {
  if (!color) return null
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return null
  const n = Number.parseInt(m[1] as string, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** WCAG 상대 휘도 */
export function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG 대비 비율(1~21) */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

const css = ([r, g, b]: Rgb): string => `rgb(${r} ${g} ${b})`

/** 라벨 색 → 칩 색. 색이 없거나 잘못되면 null(중립 배지로 그린다) */
export function labelChipColors(color: string | null | undefined): LabelChipColors | null {
  const bg = parseHexColor(color)
  if (!bg) return null
  const fg = contrastRatio(bg, DARK) >= contrastRatio(bg, LIGHT) ? DARK : LIGHT
  return { background: css(bg), foreground: css(fg) }
}
