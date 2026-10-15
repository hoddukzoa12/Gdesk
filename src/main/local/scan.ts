// 클론 기본 폴더에서 git 작업 폴더 찾기(spec 4.11).
import type { Dirent } from 'node:fs'
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'

export const DEFAULT_SCAN_DEPTH = 2

const SKIP_NAMES = new Set(['node_modules'])

async function hasGitEntry(dir: string): Promise<boolean> {
  try {
    // 작업 폴더는 .git 폴더, 워크트리·서브모듈은 .git 파일
    await lstat(join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

/**
 * base 아래 깊이 maxDepth(기본 2, base 의 바로 아래가 1)까지 `.git` 이 있는 폴더를 찾는다.
 * 숨김 폴더·node_modules 는 건너뛰고, 찾은 저장소 안으로는 내려가지 않는다.
 * 폴더를 가리키는 심볼릭 링크는 따라가되 실제 경로로 한 번만 방문해 고리에서 멈춘다.
 * base 가 없거나 읽을 수 없으면 빈 목록.
 */
export async function findGitWorkingCopies(
  base: string,
  options: { maxDepth?: number } = {}
): Promise<string[]> {
  const maxDepth = options.maxDepth ?? DEFAULT_SCAN_DEPTH
  const visited = new Set<string>()
  const found: string[] = []

  const walk = async (dir: string, depth: number): Promise<void> => {
    let real: string
    try {
      real = await realpath(dir)
    } catch {
      return
    }
    if (visited.has(real)) return
    visited.add(real)

    if (await hasGitEntry(dir)) {
      found.push(dir)
      return
    }
    if (depth >= maxDepth) return

    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_NAMES.has(entry.name)) continue
      const child = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(child, depth + 1)
      } else if (entry.isSymbolicLink()) {
        const target = await stat(child).catch(() => null)
        if (target?.isDirectory()) await walk(child, depth + 1)
      }
    }
  }

  try {
    if (!(await stat(base)).isDirectory()) return []
  } catch {
    return []
  }
  await walk(base, 0)
  return found
}
