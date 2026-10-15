import { describe, expect, it } from 'vitest'
import { contrastRatio, labelChipColors, parseHexColor } from './labelColor'

function rgbOf(css: string): [number, number, number] {
  const m = /^rgb\((\d+) (\d+) (\d+)\)$/.exec(css)
  if (!m) throw new Error(`not rgb: ${css}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

describe('labelChipColors', () => {
  it('밝은 라벨은 검은 글자, 어두운 라벨은 흰 글자', () => {
    expect(labelChipColors('fbca04')).toEqual({
      background: 'rgb(251 202 4)',
      foreground: 'rgb(0 0 0)'
    })
    expect(labelChipColors('a2eeef')?.foreground).toBe('rgb(0 0 0)')
    expect(labelChipColors('0075ca')?.foreground).toBe('rgb(255 255 255)')
    expect(labelChipColors('#000000')?.foreground).toBe('rgb(255 255 255)')
  })

  it('색이 없거나 잘못되면 null(중립 배지)', () => {
    expect(labelChipColors(null)).toBeNull()
    expect(labelChipColors('')).toBeNull()
    expect(labelChipColors('red')).toBeNull()
    expect(labelChipColors('fff')).toBeNull()
    expect(labelChipColors('zzzzzz')).toBeNull()
  })

  it('어떤 라벨 색에서도 글자 대비가 4.5:1 이상', () => {
    for (let r = 0; r <= 255; r += 15) {
      for (let g = 0; g <= 255; g += 15) {
        for (let b = 0; b <= 255; b += 15) {
          const hex = [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
          const colors = labelChipColors(hex)
          expect(colors).not.toBeNull()
          const ratio = contrastRatio(rgbOf(colors!.background), rgbOf(colors!.foreground))
          expect(ratio, hex).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it('16진수 해석', () => {
    expect(parseHexColor('d73a4a')).toEqual([215, 58, 74])
    expect(parseHexColor('#D73A4A')).toEqual([215, 58, 74])
  })
})
