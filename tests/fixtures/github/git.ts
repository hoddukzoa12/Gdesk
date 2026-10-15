import { readFileSync, statSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { exec } from 'dugite'

/**
 * 클론 테스트용 bare 저장소. 가짜 서버는 이것을 git "dumb HTTP" 방식(정적 파일)으로
 * `{webBase}/{owner}/{repo}.git` 에서 내준다. 사용자의 git 설정은 끼어들지 않게 막는다.
 */

const ISOLATED_ENV = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0'
}

async function git(args: string[], cwd: string, globalConfig: string): Promise<void> {
  const result = await exec(args, cwd, {
    env: { ...ISOLATED_ENV, GIT_CONFIG_GLOBAL: globalConfig }
  })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr)}`)
  }
}

/** root 아래에 `{owner}/{name}.git` bare 저장소들을 만든다(README 커밋 하나, main 브랜치) */
export async function createBareRepos(root: string, fullNames: readonly string[]): Promise<void> {
  const globalConfig = join(root, '.empty-gitconfig')
  await mkdir(root, { recursive: true })
  await writeFile(globalConfig, '')
  for (const fullName of fullNames) {
    const work = join(root, '.work', fullName)
    await mkdir(work, { recursive: true })
    await git(['init', '-q', '-b', 'main'], work, globalConfig)
    await writeFile(
      join(work, 'README.md'),
      `# ${fullName}\n\nFixture repository for Gdesk tests.\n`
    )
    await git(['add', 'README.md'], work, globalConfig)
    await git(
      [
        '-c',
        'user.name=Octo Maintainer',
        '-c',
        'user.email=octo-maintainer@example.test',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-q',
        '-m',
        'Initial commit'
      ],
      work,
      globalConfig
    )
    const bare = join(root, `${fullName}.git`)
    await git(['clone', '-q', '--bare', '--no-local', work, bare], root, globalConfig)
    // dumb HTTP 에 필요한 info/refs, objects/info/packs
    await git(['update-server-info'], bare, globalConfig)
  }
  await rm(join(root, '.work'), { recursive: true, force: true })
}

/** `/{owner}/{repo}.git/<file>` 요청을 root 안의 파일로. 없거나 root 밖이면 null */
export function readGitFile(root: string, path: string): Buffer | null {
  const m = /^\/([^/]+)\/([^/]+\.git)\/(.+)$/.exec(path)
  if (!m) return null
  // 그 저장소 폴더 안의 파일만 내준다
  const repoDir = resolve(
    root,
    decodeURIComponent(m[1] as string),
    decodeURIComponent(m[2] as string)
  )
  const file = resolve(repoDir, decodeURIComponent(m[3] as string))
  if (!repoDir.startsWith(resolve(root) + sep) || !file.startsWith(repoDir + sep)) return null
  try {
    if (!statSync(file).isFile()) return null
    return readFileSync(file)
  } catch {
    return null
  }
}
