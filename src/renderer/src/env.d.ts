/// <reference types="vite/client" />

import type { LiveMockPreloadApi } from '@shared/ipc'

declare global {
  interface Window {
    livemock: LiveMockPreloadApi
  }
}

export {}
