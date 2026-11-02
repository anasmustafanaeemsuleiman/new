import { toDataURL } from 'qrcode'

/**
 * The deep link a QR code carries. It is intentionally a normal URL so it also
 * works if the code is scanned with the phone's camera app or shared as a link.
 */
export function profileLink(username: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#/u/${encodeURIComponent(username)}`
}

export async function qrDataUrl(text: string): Promise<string> {
  return toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 560,
    color: { dark: '#0b141a', light: '#ffffff' },
  })
}

/** Reads `#/u/<username>` from a location hash. */
export function parseDeepLink(hash: string): string | null {
  const match = /^#\/u\/([^/?#]+)/.exec(hash)
  if (!match) return null
  try {
    const username = decodeURIComponent(match[1]).toLowerCase()
    return /^[a-z0-9_]{3,20}$/.test(username) ? username : null
  } catch {
    return null
  }
}

/** Accepts our deep link, a bare `@username` or a plain username from a scan. */
export function usernameFromScan(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null

  const fromUrl = /#\/u\/([^/?#]+)/.exec(text)
  if (fromUrl) {
    try {
      const username = decodeURIComponent(fromUrl[1]).toLowerCase()
      if (/^[a-z0-9_]{3,20}$/.test(username)) return username
    } catch {
      /* ignore malformed payloads */
    }
  }

  const plain = /^@?([a-z0-9_]{3,20})$/i.exec(text)
  return plain ? plain[1].toLowerCase() : null
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
