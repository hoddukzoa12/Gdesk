import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { InsecureStorageChoice, SessionUser, TokenKind } from '@shared/domain/session'

/**
 * 토큰 저장소(spec §5). OS 보안 저장소(Electron safeStorage)로 암호화해 사용자 데이터 폴더에 둔다.
 * 리눅스에서 키링이 없어(basic_text) 안전하게 암호화할 수 없으면 사용자가 고른다.
 *   (a) save   — 소유자만 읽는 0600 파일로 저장
 *   (b) memory — 저장하지 않음(이번 실행에만 메모리)
 * Electron 호출은 SecretStorageBackend 뒤에 둬서 단위 테스트는 Node 만으로 돈다.
 */

/** Electron safeStorage 의 필요한 부분 */
export interface SecretStorageBackend {
  platform: NodeJS.Platform
  isEncryptionAvailable(): boolean
  /** 리눅스에서만 부른다 */
  getSelectedStorageBackend(): string
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

/** 저장하는 값. 사용자 정보는 오프라인 시작 때 화면에 보여 주려고 함께 둔다. */
export interface StoredCredential {
  token: string
  tokenKind: TokenKind
  user: SessionUser
  scopes: string[] | null
}

/**
 * encrypted: OS 보안 저장소로 암호화해 저장함
 * insecure_file: 사용자 동의로 0600 파일에 저장함
 * memory: 저장하지 않음(메모리에만)
 * needs_choice: 리눅스 약한 암호화 — 사용자가 고를 때까지 저장하지 않음
 */
export type SaveOutcome = 'encrypted' | 'insecure_file' | 'memory' | 'needs_choice'

export interface TokenStoreOptions {
  /** 사용자 데이터 폴더(app.getPath('userData')) */
  dir: string
  backend: SecretStorageBackend
}

const FILE_MODE = 0o600
const DIR_MODE = 0o700

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseCredential(text: string): StoredCredential | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value)) return null
  const { token, tokenKind, user, scopes } = value
  if (typeof token !== 'string' || token === '') return null
  if (tokenKind !== 'classic' && tokenKind !== 'fine_grained' && tokenKind !== 'oauth') return null
  if (!isRecord(user) || typeof user.id !== 'number' || typeof user.login !== 'string') return null
  if (scopes !== null && !(Array.isArray(scopes) && scopes.every((s) => typeof s === 'string'))) {
    return null
  }
  return {
    token,
    tokenKind,
    user: {
      id: user.id,
      login: user.login,
      name: typeof user.name === 'string' ? user.name : null,
      avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : '',
      // 이메일 필드가 생기기 전에 저장한 기록은 null(다음 재확인이 채운다)
      email: typeof user.email === 'string' && user.email !== '' ? user.email : null
    },
    scopes: scopes as string[] | null
  }
}

export class TokenStore {
  readonly authDir: string
  readonly encryptedPath: string
  readonly plainPath: string
  readonly choicePath: string
  private readonly backend: SecretStorageBackend

  constructor(options: TokenStoreOptions) {
    this.backend = options.backend
    this.authDir = join(options.dir, 'auth')
    this.encryptedPath = join(this.authDir, 'credential.enc')
    this.plainPath = join(this.authDir, 'credential.insecure.json')
    this.choicePath = join(this.authDir, 'storage-choice.json')
  }

  /** 리눅스에서 키링이 없거나(basic_text) 암호화를 쓸 수 없으면 true */
  isWeakEncryption(): boolean {
    if (this.backend.platform !== 'linux') return false
    if (!this.backend.isEncryptionAvailable()) return true
    return this.backend.getSelectedStorageBackend() === 'basic_text'
  }

  getInsecureChoice(): InsecureStorageChoice | null {
    try {
      const value: unknown = JSON.parse(readFileSync(this.choicePath, 'utf8'))
      const choice = isRecord(value) ? value.choice : undefined
      return choice === 'save' || choice === 'memory' ? choice : null
    } catch {
      return null
    }
  }

  setInsecureChoice(choice: InsecureStorageChoice): void {
    this.writePrivate(this.choicePath, JSON.stringify({ choice }))
  }

  load(): StoredCredential | null {
    if (existsSync(this.encryptedPath) && this.backend.isEncryptionAvailable()) {
      try {
        const text = this.backend.decryptString(readFileSync(this.encryptedPath))
        const cred = parseCredential(text)
        if (cred) return cred
      } catch {
        // 키가 바뀌었거나 손상됨: 아래에서 지운다
      }
      this.remove(this.encryptedPath)
      return null
    }
    if (existsSync(this.plainPath) && this.getInsecureChoice() === 'save') {
      try {
        return parseCredential(readFileSync(this.plainPath, 'utf8'))
      } catch {
        return null
      }
    }
    return null
  }

  save(cred: StoredCredential): SaveOutcome {
    const json = JSON.stringify(cred)
    if (this.isWeakEncryption()) {
      const choice = this.getInsecureChoice()
      if (choice === null) return 'needs_choice'
      this.remove(this.encryptedPath)
      if (choice === 'memory') {
        this.remove(this.plainPath)
        return 'memory'
      }
      this.writePrivate(this.plainPath, json)
      return 'insecure_file'
    }
    if (!this.backend.isEncryptionAvailable()) {
      // 리눅스가 아닌데 OS 저장소를 못 쓰는 경우: 평문으로 두지 않는다
      this.clear()
      return 'memory'
    }
    this.writePrivate(this.encryptedPath, this.backend.encryptString(json))
    this.remove(this.plainPath)
    return 'encrypted'
  }

  /** 저장된 토큰을 지운다. 고른 저장 방법은 남긴다. */
  clear(): void {
    this.remove(this.encryptedPath)
    this.remove(this.plainPath)
  }

  private writePrivate(path: string, data: string | Buffer): void {
    mkdirSync(this.authDir, { recursive: true, mode: DIR_MODE })
    chmodSync(this.authDir, DIR_MODE)
    // mode 옵션은 새 파일에만 적용되므로 이미 있던 파일은 내용을 쓰기 전에 권한부터 좁힌다
    if (existsSync(path)) chmodSync(path, FILE_MODE)
    writeFileSync(path, data, { mode: FILE_MODE })
    chmodSync(path, FILE_MODE)
  }

  private remove(path: string): void {
    rmSync(path, { force: true })
  }
}
