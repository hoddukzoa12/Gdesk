// 테스트 전용 도우미. 앱 코드에서 import 하지 않는다.
import { writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { exec } from 'dugite'
import { vi } from 'vitest'

/** 내장 git 을 실행하고 실패하면 예외를 던진다. */
export async function git(args: string[], cwd: string): Promise<string> {
  const result = await exec(args, cwd)
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout
}

/** 개발자의 ~/.gitconfig(서명, insteadOf 등)가 테스트에 끼어들지 않게 빈 전역 설정을 쓴다. */
export function isolateGitConfig(root: string): void {
  const globalConfig = join(root, 'empty-global.gitconfig')
  writeFileSync(globalConfig, '')
  vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig)
}

/** 커밋 하나가 있는 bare 저장소를 만들어 경로를 돌려준다. */
export async function makeBareRepo(root: string): Promise<string> {
  const work = join(root, 'source-work')
  await mkdir(work)
  await git(['init', '-q'], work)
  await writeFile(join(work, 'README.md'), '# fixture\n')
  await writeFile(join(work, 'a.txt'), 'hello\n')
  await git(['add', '.'], work)
  await git(
    [
      '-c',
      'user.name=Gdesk Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      'init'
    ],
    work
  )
  const bare = join(root, 'source.git')
  await git(['clone', '-q', '--bare', work, bare], root)
  return bare
}
