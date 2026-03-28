import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const UI_ROOT = resolve(__dirname, 'ui')
const UI_DIST = resolve(UI_ROOT, 'dist')
const DEV_HOST = '127.0.0.1'
const DEV_PORT = 1420
const HMR_PORT = 1421

export default defineConfig({
  root: UI_ROOT,
  publicDir: false,
  server: {
    host: DEV_HOST,
    port: DEV_PORT,
    strictPort: true,
    hmr: {
      host: DEV_HOST,
      port: HMR_PORT,
    },
  },
  preview: {
    host: DEV_HOST,
    port: DEV_PORT,
    strictPort: true,
  },
  build: {
    outDir: UI_DIST,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(UI_ROOT, 'index.html'),
        bar: resolve(UI_ROOT, 'bar.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost',
      },
    },
    // Installs a reliable in-memory localStorage before any test runs,
    // replacing the Node 25 --localstorage-file implementation that lacks .clear().
    setupFiles: ['src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
  },
})
