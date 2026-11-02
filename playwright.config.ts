import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
import { SUBPATH_CASES } from './tests/subpaths'

/**
 * Minimal Linux images often lack Chromium's shared libraries and fonts and
 * cannot install them without root. tests/setup-browser-libs.mjs unpacks them
 * locally; when present we hand them to the browser here.
 */
const localLibs = fileURLToPath(
  new URL('./.cache/browser-libs/root/usr/lib/x86_64-linux-gnu', import.meta.url),
)
const localFonts = fileURLToPath(new URL('./.cache/browser-libs/fonts.conf', import.meta.url))
const launchEnv: Record<string, string> = {}
if (existsSync(localLibs) || existsSync(localFonts)) {
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') launchEnv[key] = value
  }
}
if (existsSync(localLibs)) {
  launchEnv.LD_LIBRARY_PATH = [localLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
}
if (existsSync(localFonts)) {
  // Without a fontconfig file Skia aborts the browser (SIGTRAP) on first paint.
  launchEnv.FONTCONFIG_FILE = localFonts
  launchEnv.FONTCONFIG_PATH = fileURLToPath(new URL('./.cache/browser-libs', import.meta.url))
}

const cleanEnv = (): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  return env
}

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    // Every test runs against the *production build* served at a repo subpath,
    // exactly like GitHub Pages, never against the dev server.
    baseURL: `http://127.0.0.1:${SUBPATH_CASES[0].port}/${SUBPATH_CASES[0].name}/`,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'off',
    ...(Object.keys(launchEnv).length > 0 ? { launchOptions: { env: launchEnv } } : {}),
  },
  webServer: SUBPATH_CASES.map(({ name, port }) => ({
    command: 'node tests/serve-subpath.mjs',
    env: { ...cleanEnv(), SUBPATH: `/${name}`, PORT: String(port) },
    url: `http://127.0.0.1:${port}/${name}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  })),
})
