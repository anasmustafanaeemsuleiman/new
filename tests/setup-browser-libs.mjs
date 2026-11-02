import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

/**
 * Minimal Linux containers (CI images, sandboxes) often ship without the shared
 * libraries AND fonts Chromium needs, and installing them normally needs root.
 *
 * This script downloads the Ubuntu packages and unpacks them into
 * ./.cache/browser-libs with `dpkg-deb -x` (no root), writes a fontconfig file
 * pointing at the unpacked fonts, and playwright.config.ts points LD_LIBRARY_PATH
 * and FONTCONFIG_FILE there. Without fonts Chromium dies with
 * "FATAL: SkFontMgr_FontConfigInterface ... Not implemented".
 *
 * No-op on non-Linux hosts and on hosts that already have everything.
 * Test harness only — not part of the app.
 */

const PROJECT = fileURLToPath(new URL('..', import.meta.url))
const CACHE = join(PROJECT, '.cache', 'browser-libs')
const EXTRACT = join(CACHE, 'root')
const LIB_DIR = join(EXTRACT, 'usr', 'lib', 'x86_64-linux-gnu')
const FONT_DIR = join(EXTRACT, 'usr', 'share', 'fonts')
const FONTS_CONF = join(CACHE, 'fonts.conf')
const MARKER = join(CACHE, 'installed')

const RELEASE = 'noble'
const MIRROR = 'https://archive.ubuntu.com/ubuntu'

const PACKAGES = [
  // shared libraries Chromium links against
  'libnspr4',
  'libnss3',
  'libsqlite3-0',
  'libasound2t64',
  'libatk1.0-0t64',
  'libatk-bridge2.0-0t64',
  'libatspi2.0-0t64',
  'libxcomposite1',
  'libxdamage1',
  'libxfixes3',
  'libxrandr2',
  'libxkbcommon0',
  'libdbus-1-3',
  'libglib2.0-0t64',
  'libxext6',
  'libxi6',
  'libxtst6',
  'libxrender1',
  'libx11-6',
  'libxcb1',
  // fonts — Skia aborts without at least one usable font
  'fonts-dejavu-core',
  'fonts-liberation',
]

function chromeBinaries() {
  const roots = [
    join(process.env.HOME ?? '', '.cache', 'ms-playwright'),
    join(PROJECT, 'node_modules', '.cache', 'ms-playwright'),
  ].filter((root) => root && existsSync(root))

  const found = []
  for (const root of roots) {
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('chromium')) continue
      for (const sub of [
        'chrome-headless-shell-linux64/chrome-headless-shell',
        'chrome-linux/chrome',
      ]) {
        const candidate = join(root, entry, sub)
        if (existsSync(candidate)) found.push(candidate)
      }
    }
  }
  return found
}

/** Libraries the loader still cannot resolve, with our tree on the path. */
function missingLibs(binaries) {
  const path = [LIB_DIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
  const missing = new Set()
  for (const binary of binaries) {
    let output = ''
    try {
      output = execFileSync('ldd', [binary], {
        encoding: 'utf8',
        env: { ...process.env, LD_LIBRARY_PATH: path },
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      continue
    }
    for (const line of output.split('\n')) {
      if (line.includes('not found')) missing.add(line.trim().split(' => ')[0].trim())
    }
  }
  return [...missing]
}

function writeFontsConf() {
  if (!existsSync(FONT_DIR)) return false
  const cacheDir = join(CACHE, 'fontcache')
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(
    FONTS_CONF,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${FONT_DIR}</dir>
  <dir>/usr/share/fonts</dir>
  <cachedir>${cacheDir}</cachedir>
</fontconfig>
`,
  )
  return true
}

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

function parseIndex(buffer) {
  const map = new Map()
  for (const stanza of gunzipSync(buffer).toString('utf8').split('\n\n')) {
    const name = /^Package:\s*(.+)$/m.exec(stanza)?.[1]?.trim()
    const filename = /^Filename:\s*(.+)$/m.exec(stanza)?.[1]?.trim()
    if (name && filename && !map.has(name)) map.set(name, filename)
  }
  return map
}

async function main() {
  if (process.platform !== 'linux') {
    console.log('[browser-libs] not Linux — nothing to do')
    return
  }

  const binaries = chromeBinaries()
  if (binaries.length === 0) {
    console.log('[browser-libs] no Chromium in the Playwright cache yet — run "npx playwright install chromium"')
    return
  }

  if (existsSync(MARKER) && existsSync(FONTS_CONF) && missingLibs(binaries).length === 0) {
    console.log('[browser-libs] already satisfied')
    return
  }

  const wanted = missingLibs(binaries)
  console.log(`[browser-libs] host misses: ${wanted.join(', ') || 'nothing'}`)

  const index = new Map()
  for (const component of ['main', 'universe']) {
    console.log(`[browser-libs] reading ${component} index…`)
    const url = `${MIRROR}/dists/${RELEASE}/${component}/binary-amd64/Packages.gz`
    for (const [name, filename] of parseIndex(await download(url))) {
      if (!index.has(name)) index.set(name, filename)
    }
  }

  rmSync(EXTRACT, { recursive: true, force: true })
  mkdirSync(EXTRACT, { recursive: true })
  const debDir = join(CACHE, 'debs')
  mkdirSync(debDir, { recursive: true })

  for (const name of PACKAGES) {
    const filename = index.get(name)
    if (!filename) {
      console.warn(`[browser-libs] not in index: ${name}`)
      continue
    }
    const debPath = join(debDir, `${name}.deb`)
    try {
      writeFileSync(debPath, await download(`${MIRROR}/${filename}`))
      execFileSync('dpkg-deb', ['-x', debPath, EXTRACT], { stdio: 'ignore' })
      console.log(`[browser-libs] extracted ${name}`)
    } catch (error) {
      console.warn(`[browser-libs] failed for ${name}: ${error instanceof Error ? error.message : error}`)
    }
  }

  // Ubuntu ships the versioned soname (libfoo.so.1); create the bare names the
  // loader asks for when a package only provides one of the two.
  if (existsSync(LIB_DIR)) {
    const available = readdirSync(LIB_DIR)
    for (const soname of missingLibs(binaries)) {
      if (available.includes(soname)) continue
      const candidate = available.find((file) => file.startsWith(soname))
      if (!candidate) continue
      try {
        execFileSync('ln', ['-s', join(LIB_DIR, candidate), join(LIB_DIR, soname)], { stdio: 'ignore' })
      } catch {
        /* already linked */
      }
    }
  }

  const fontsReady = writeFontsConf()
  console.log(`[browser-libs] fonts: ${fontsReady ? FONTS_CONF : 'none found'}`)

  const remaining = missingLibs(binaries)
  if (remaining.length > 0) {
    console.error(`[browser-libs] still missing after install: ${remaining.join(', ')}`)
    process.exitCode = 1
    return
  }

  writeFileSync(MARKER, new Date().toISOString())
  console.log(`[browser-libs] ready → LD_LIBRARY_PATH=${LIB_DIR}`)
}

await main()
