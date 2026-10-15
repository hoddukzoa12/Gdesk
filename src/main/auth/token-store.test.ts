import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TokenStore, type StoredCredential } from './token-store'
import { fakeSecretBackend } from './test-helpers'

const TOKEN = 'ghp_StoreSecretToken1234567890abcdefgh'

const cred: StoredCredential = {
  token: TOKEN,
  tokenKind: 'classic',
  user: { id: 1, login: 'octo', name: null, avatarUrl: 'https://avatars.example/u/1' },
  scopes: ['repo']
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777
}

/** 디렉터리 안 모든 파일 내용을 이어 붙인다(평문 토큰이 남았는지 확인용) */
function allContent(dir: string): string {
  if (!existsSync(dir)) return ''
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => readFileSync(join(d.parentPath, d.name), 'utf8'))
    .join('\n')
}

describe('TokenStore', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gdesk-auth-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('OS 보안 저장소를 쓸 수 있을 때', () => {
    it('암호화해 저장하고 다시 읽는다. 평문 토큰은 파일에 없다', () => {
      const store = new TokenStore({ dir, backend: fakeSecretBackend() })
      expect(store.isWeakEncryption()).toBe(false)
      expect(store.save(cred)).toBe('encrypted')
      expect(allContent(dir)).not.toContain(TOKEN)
      expect(modeOf(store.encryptedPath)).toBe(0o600)

      const again = new TokenStore({ dir, backend: fakeSecretBackend() })
      expect(again.load()).toEqual(cred)
    })

    it('clear 는 저장된 토큰을 지운다', () => {
      const store = new TokenStore({ dir, backend: fakeSecretBackend() })
      store.save(cred)
      store.clear()
      expect(existsSync(store.encryptedPath)).toBe(false)
      expect(store.load()).toBeNull()
    })

    it('복호화할 수 없는 파일은 무시하고 지운다', () => {
      const store = new TokenStore({ dir, backend: fakeSecretBackend() })
      store.save(cred)
      writeFileSync(store.encryptedPath, 'garbage')
      const broken = new TokenStore({
        dir,
        backend: fakeSecretBackend({
          decryptString: () => {
            throw new Error('cannot decrypt')
          }
        })
      })
      expect(broken.load()).toBeNull()
      expect(existsSync(broken.encryptedPath)).toBe(false)
    })

    it('리눅스라도 키링(gnome_libsecret)이 있으면 묻지 않는다', () => {
      const store = new TokenStore({
        dir,
        backend: fakeSecretBackend({
          platform: 'linux',
          getSelectedStorageBackend: () => 'gnome_libsecret'
        })
      })
      expect(store.isWeakEncryption()).toBe(false)
      expect(store.save(cred)).toBe('encrypted')
    })
  })

  describe('리눅스에서 안전한 암호화를 쓸 수 없을 때', () => {
    const basicText = () =>
      fakeSecretBackend({ platform: 'linux', getSelectedStorageBackend: () => 'basic_text' })

    it('basic_text 이면 약한 암호화로 보고, 고르기 전에는 저장하지 않는다', () => {
      const store = new TokenStore({ dir, backend: basicText() })
      expect(store.isWeakEncryption()).toBe(true)
      expect(store.getInsecureChoice()).toBeNull()
      expect(store.save(cred)).toBe('needs_choice')
      expect(allContent(dir)).not.toContain(TOKEN)
      expect(existsSync(store.encryptedPath)).toBe(false)
      expect(existsSync(store.plainPath)).toBe(false)
    })

    it('암호화를 아예 쓸 수 없어도 약한 경우로 본다', () => {
      const store = new TokenStore({
        dir,
        backend: fakeSecretBackend({
          platform: 'linux',
          isEncryptionAvailable: () => false,
          getSelectedStorageBackend: () => 'gnome_libsecret'
        })
      })
      expect(store.isWeakEncryption()).toBe(true)
    })

    it('(a) 그래도 저장: 0600 파일에 저장하고, 고른 것을 기억한다', () => {
      const store = new TokenStore({ dir, backend: basicText() })
      store.setInsecureChoice('save')
      expect(store.save(cred)).toBe('insecure_file')
      expect(modeOf(store.plainPath)).toBe(0o600)
      expect(existsSync(store.encryptedPath)).toBe(false)

      const again = new TokenStore({ dir, backend: basicText() })
      expect(again.getInsecureChoice()).toBe('save')
      expect(again.load()).toEqual(cred)
      expect(again.save(cred)).toBe('insecure_file')
      expect(modeOf(again.plainPath)).toBe(0o600)
    })

    it('이미 있던 파일의 권한이 넓어도 0600 으로 고친다', () => {
      const store = new TokenStore({ dir, backend: basicText() })
      store.setInsecureChoice('save')
      store.save(cred)
      chmodSync(store.plainPath, 0o644)
      expect(modeOf(store.plainPath)).toBe(0o644)
      store.save(cred)
      expect(modeOf(store.plainPath)).toBe(0o600)
    })

    it('(b) 저장하지 않음: 파일을 만들지 않고, 고른 것을 기억한다', () => {
      const store = new TokenStore({ dir, backend: basicText() })
      store.setInsecureChoice('memory')
      expect(store.save(cred)).toBe('memory')
      expect(allContent(dir)).not.toContain(TOKEN)

      const again = new TokenStore({ dir, backend: basicText() })
      expect(again.getInsecureChoice()).toBe('memory')
      expect(again.load()).toBeNull()
      expect(again.save(cred)).toBe('memory')
    })

    it('고른 값 파일에는 토큰이 없다', () => {
      const store = new TokenStore({ dir, backend: basicText() })
      store.setInsecureChoice('save')
      expect(readFileSync(store.choicePath, 'utf8')).not.toContain(TOKEN)
    })
  })

  it('리눅스가 아닌데 암호화를 쓸 수 없으면 메모리에만 둔다(묻지 않음)', () => {
    const store = new TokenStore({
      dir,
      backend: fakeSecretBackend({ platform: 'win32', isEncryptionAvailable: () => false })
    })
    expect(store.isWeakEncryption()).toBe(false)
    expect(store.save(cred)).toBe('memory')
    expect(allContent(dir)).not.toContain(TOKEN)
  })

  it('저장 폴더는 소유자만 접근한다(0700)', () => {
    const store = new TokenStore({ dir, backend: fakeSecretBackend() })
    store.save(cred)
    expect(modeOf(store.authDir)).toBe(0o700)
  })
})
