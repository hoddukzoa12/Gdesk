import type { GdeskApi } from '../shared/ipc/contract'

declare global {
  interface Window {
    gdesk: GdeskApi
  }
}

export {}
