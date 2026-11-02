import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Serves the production build the way GitHub Pages serves a project site:
 * https://user.github.io/<repo>/ → dist/.
 *
 * The folder name is configurable, because it is the repository name:
 *   SUBPATH=/chat-app PORT=4182 node tests/serve-subpath.mjs
 *
 * Anything outside the subpath is a 404, and a missing file is a 404 (no SPA
 * fallback), so wrong asset URLs are caught instead of silently resolving.
 */
const ROOT = fileURLToPath(new URL('../dist/', import.meta.url))

const rawPrefix = process.env.SUBPATH ?? '/repo'
const PREFIX = `/${rawPrefix.replace(/^\/+|\/+$/g, '')}` || '/repo'
const PORT = Number(process.env.PORT ?? 4181)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const pathname = decodeURIComponent(url.pathname)

  if (!pathname.startsWith(`${PREFIX}/`) && pathname !== PREFIX) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end(`outside ${PREFIX}: ${pathname}`)
    return
  }

  let relative = pathname.slice(PREFIX.length)
  if (relative === '' || relative.endsWith('/')) relative += 'index.html'

  const filePath = normalize(join(ROOT, relative))
  if (!filePath.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    response.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden')
    return
  }

  try {
    const body = await readFile(filePath)
    response.writeHead(200, {
      'content-type': TYPES[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    response.end(body)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${relative}`)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`subpath server ready: http://127.0.0.1:${PORT}${PREFIX}/ (root: ${ROOT})`)
})
