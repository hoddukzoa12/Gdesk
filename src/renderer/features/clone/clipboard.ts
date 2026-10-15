/**
 * 글자를 클립보드에 쓴다. navigator.clipboard 가 없거나 거절하면(창에 포커스가 없을 때 등)
 * 숨긴 textarea + execCommand('copy') 로 한 번 더 시도한다. 둘 다 실패하면 false.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 아래 방법으로 다시 시도
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}
