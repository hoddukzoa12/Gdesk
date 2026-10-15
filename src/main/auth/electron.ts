import { app, safeStorage } from 'electron'
import { TokenStore, type SecretStorageBackend } from './token-store'

/** Electron safeStorage 연결부. app ready 뒤에만 부른다(그 전에는 암호화를 쓸 수 없다). */
export function electronSecretBackend(): SecretStorageBackend {
  return {
    platform: process.platform,
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    // 리눅스 전용 API. 다른 OS 에서는 부르지 않는다.
    getSelectedStorageBackend: () =>
      process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'unknown',
    encryptString: (plainText) => safeStorage.encryptString(plainText),
    decryptString: (encrypted) => safeStorage.decryptString(encrypted)
  }
}

/** 사용자 데이터 폴더의 `auth/` 아래에 토큰을 두는 저장소 */
export function createElectronTokenStore(): TokenStore {
  return new TokenStore({ dir: app.getPath('userData'), backend: electronSecretBackend() })
}
