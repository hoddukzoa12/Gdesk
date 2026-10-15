// 설치 파일 빌드 설정(electron-builder). `pnpm dist` / CI 릴리스가 쓴다.
// 서명·공증은 비밀값이 있을 때만 한다. 없으면 서명 단계만 건너뛰고 빌드는 성공한다(docs/signing.md).
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readSync, realpathSync } from 'node:fs'
import { arch as osArch } from 'node:os'
import { join } from 'node:path'
import type { AfterPackContext, Configuration } from 'electron-builder'

const env = process.env
const has = (name: string): boolean => Boolean(env[name]?.trim())

/** `소유자/이름`. 비어 있거나 형식이 틀리면 게시·업데이트 설정을 넣지 않는다. */
const repoMatch = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(env.GDESK_REPO?.trim() ?? '')
const repo = repoMatch ? { owner: repoMatch[1] as string, name: repoMatch[2] as string } : null

/** 맥 인증서(CSC_LINK = .p12 base64/경로, 또는 키체인의 CSC_NAME). */
const macCert = has('CSC_LINK') || has('CSC_NAME')
/** 공증 정보(앱 전용 암호 방식 또는 App Store Connect API 키 방식). 인증서 없이는 공증하지 않는다. */
const macNotarize =
  macCert &&
  ((has('APPLE_ID') && has('APPLE_APP_SPECIFIC_PASSWORD') && has('APPLE_TEAM_ID')) ||
    (has('APPLE_API_KEY') && has('APPLE_API_KEY_ID') && has('APPLE_API_ISSUER')))

// ── 내장 git(dugite) ──
// dugite 는 설치할 때 그 기계의 CPU 용 git 을 받는다. 애플 실리콘 기계에서 Intel(x64) 맥 앱을 만들면
// 다른 CPU 의 git 이 들어가므로, 패키징 직전에 대상 CPU 용 git 으로 바꾸고 끝나면 되돌린다.
const ARCH_NAMES: Record<number, string> = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal'
}

function dugiteDir(projectDir: string): string {
  return realpathSync(join(projectDir, 'node_modules', 'dugite'))
}

/** Mach-O 실행 파일의 CPU. 두 CPU 를 다 담은 파일이면 'universal'. */
function machOArch(file: string): string | null {
  const buf = Buffer.alloc(8)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, buf, 0, 8, 0)
  } finally {
    closeSync(fd)
  }
  if (buf.readUInt32BE(0) === 0xcafebabe) return 'universal'
  if (buf.readUInt32LE(0) !== 0xfeedfacf) return null
  const cpu = buf.readUInt32LE(4)
  if (cpu === 0x01000007) return 'x64'
  if (cpu === 0x0100000c) return 'arm64'
  return null
}

/** node_modules 의 dugite git 을 지정 CPU 용으로 맞춘다. 바꿨으면 true. */
function ensureMacGit(projectDir: string, arch: string): boolean {
  const dir = dugiteDir(projectDir)
  const gitBin = join(dir, 'git', 'bin', 'git')
  const current = existsSync(gitBin) ? machOArch(gitBin) : null
  if (current === arch || current === 'universal') return false
  console.log(`  • dugite: git ${current ?? '없음'} → ${arch} 로 교체`)
  execFileSync(process.execPath, [join(dir, 'script', 'download-git.js')], {
    stdio: 'inherit',
    env: { ...env, npm_config_arch: arch }
  })
  const after = machOArch(gitBin)
  if (after !== arch) throw new Error(`dugite git 교체 실패: ${arch} 를 원했지만 ${after}`)
  return true
}

let gitSwapped = false

function resourcesDir(context: AfterPackContext): string {
  if (context.electronPlatformName === 'darwin' || context.electronPlatformName === 'mas') {
    const app = `${context.packager.appInfo.productFilename}.app`
    return join(context.appOutDir, app, 'Contents', 'Resources')
  }
  return join(context.appOutDir, 'resources')
}

const config: Configuration = {
  appId: 'dev.gdesk.app',
  productName: 'Gdesk',
  copyright: 'Copyright © 2026 hoddukzoa',
  directories: { output: 'release', buildResources: 'build' },
  // 빌드 결과(out/)만 넣는다. 실행에 필요한 dependencies 는 electron-builder 가 node_modules 로 함께 넣는다.
  files: ['out/**/*'],
  asar: true,
  // dugite 의 git 실행 파일은 asar 안에서 실행할 수 없다. dugite 는 실행 시
  // app.asar → app.asar.unpacked 로 경로를 바꿔 찾는다.
  asarUnpack: ['node_modules/dugite/git/**'],
  // 네이티브 모듈이 없다(SQLite 는 node:sqlite 내장).
  npmRebuild: false,
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  extraMetadata: repo ? { homepage: `https://github.com/${repo.owner}/${repo.name}` } : undefined,
  // 자동 업데이트 정보(latest*.yml, app-update.yml)와 릴리스 게시. GDESK_REPO 가 있을 때만.
  publish: repo
    ? { provider: 'github', owner: repo.owner, repo: repo.name, releaseType: 'draft' }
    : null,

  mac: {
    category: 'public.app-category.developer-tools',
    // zip 은 맥 자동 업데이트(Squirrel.Mac)에 필요하다
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // 인증서가 없으면 서명을 건너뛴다(null). 있으면 CSC_LINK/CSC_NAME 으로 서명한다.
    identity: macCert ? undefined : null,
    notarize: macNotarize
  },
  // 윈도우 서명: WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD 가 있으면 electron-builder 가 알아서 서명한다.
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }]
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    artifactName: '${productName}-${version}-win-${arch}-setup.${ext}'
  },

  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] }
    ],
    category: 'Development',
    executableName: 'gdesk',
    synopsis: 'GitHub dashboard for open-source maintainers',
    maintainer: 'hoddukzoa <hoddukzoa@users.noreply.github.com>'
  },

  beforePack: async (context) => {
    const platform = context.electronPlatformName
    if (platform === 'darwin' && env.GDESK_MAC_SIGNED === '1' && !macCert) {
      // 서명됐다고 표시한 앱이 실제로 서명 안 되면 맥 자동 업데이트가 실패한다
      throw new Error('GDESK_MAC_SIGNED=1 이지만 맥 서명 인증서(CSC_LINK/CSC_NAME)가 없습니다.')
    }
    if (platform === 'darwin' && macCert && env.GDESK_MAC_SIGNED !== '1') {
      console.warn(
        '  • 맥 서명 빌드인데 GDESK_MAC_SIGNED=1 이 아니어서 앱은 알림만 하는 업데이트를 씁니다.'
      )
    }
    if (platform === 'darwin') {
      const arch = ARCH_NAMES[context.arch]
      if (arch === 'x64' || arch === 'arm64') {
        gitSwapped = ensureMacGit(context.packager.projectDir, arch) || gitSwapped
      }
    }
  },

  afterPack: async (context) => {
    // 패키지에 내장 git 이 asar 밖에 있는지 확인한다(없으면 클론이 안 된다)
    const gitDir = join(resourcesDir(context), 'app.asar.unpacked', 'node_modules', 'dugite', 'git')
    const isWin = context.electronPlatformName === 'win32'
    const gitBin = join(gitDir, isWin ? 'cmd' : 'bin', isWin ? 'git.exe' : 'git')
    if (!existsSync(gitBin)) throw new Error(`패키지에 내장 git 이 없습니다: ${gitBin}`)
    if (context.electronPlatformName === 'darwin') {
      const want = ARCH_NAMES[context.arch]
      const got = machOArch(gitBin)
      if (want !== 'universal' && got !== want && got !== 'universal') {
        throw new Error(`내장 git CPU 불일치: ${want} 앱에 ${got} git`)
      }
    }
    // 다른 CPU 용으로 바꿨으면 개발 환경을 위해 이 기계의 git 으로 되돌린다
    if (gitSwapped) {
      ensureMacGit(context.packager.projectDir, osArch())
      gitSwapped = false
    }
  }
}

export default config
