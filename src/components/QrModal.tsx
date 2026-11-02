import { useCallback, useEffect, useState } from 'react'
import type { Html5Qrcode } from 'html5-qrcode'
import { copyToClipboard, profileLink, qrDataUrl, usernameFromScan } from '../lib/qr'
import { normalizeUsername, type Profile } from '../lib/types'
import { CameraIcon, CopyIcon } from './Icons'
import { Modal } from './Modal'

const SCANNER_ID = 'chatter-qr-reader'

type Props = {
  me: Profile
  initialTab: 'show' | 'scan'
  onClose: () => void
  onScanned: (username: string) => void
}

export function QrModal({ me, initialTab, onClose, onScanned }: Props) {
  const [tab, setTab] = useState(initialTab)
  const [image, setImage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const link = profileLink(me.username)

  useEffect(() => {
    let alive = true
    qrDataUrl(link)
      .then((dataUrl) => {
        if (alive) setImage(dataUrl)
      })
      .catch(() => {
        if (alive) setImage(null)
      })
    return () => {
      alive = false
    }
  }, [link])

  const copy = async () => {
    const ok = await copyToClipboard(link)
    setCopied(ok)
    window.setTimeout(() => setCopied(false), 2000)
  }

  // Stable identity: a new callback would restart the camera on every render.
  const handleResult = useCallback(
    (username: string) => {
      onScanned(username)
    },
    [onScanned],
  )

  return (
    <Modal title={tab === 'show' ? 'Your QR code' : 'Scan a code'} onClose={onClose}>
      <div className="segmented" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'show'} onClick={() => setTab('show')}>
          My code
        </button>
        <button type="button" role="tab" aria-selected={tab === 'scan'} onClick={() => setTab('scan')}>
          Scan
        </button>
      </div>

      {tab === 'show' ? (
        <>
          <div className="qr-frame">
            {image ? (
              <img src={image} alt={`QR code for @${me.username}`} />
            ) : (
              <div style={{ width: 216, height: 216 }} />
            )}
          </div>
          <p className="hint" style={{ textAlign: 'center' }}>
            Let someone scan this with their camera. They get a chat with{' '}
            <strong>@{me.username}</strong> straight away — no phone number involved.
          </p>
          <div className="link-box">
            <code>{link}</code>
            <button className="icon-btn" type="button" onClick={copy} title="Copy link">
              <CopyIcon size={18} />
            </button>
          </div>
          <p className="hint" style={{ textAlign: 'center' }}>
            {copied ? 'Link copied ✓' : 'Or share that link directly.'}
          </p>
        </>
      ) : (
        <ScanPanel onResult={handleResult} />
      )}
    </Modal>
  )
}

function ScanPanel({ onResult }: { onResult: (username: string) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')

  useEffect(() => {
    let scanner: Html5Qrcode | null = null
    let finished = false
    let cancelled = false

    const start = async () => {
      try {
        // Loaded on demand: the scanner library is only needed for the scan tab.
        const { Html5Qrcode: Html5QrcodeClass } = await import('html5-qrcode')
        if (cancelled) return
        scanner = new Html5QrcodeClass(SCANNER_ID, { verbose: false })
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            if (finished) return
            const username = usernameFromScan(decoded)
            if (!username) return
            finished = true
            onResult(username)
          },
          () => {
            /* per-frame decode misses are normal */
          },
        )
      } catch (caught) {
        if (cancelled) return
        setError(cameraMessage(caught))
      }
    }

    void start()

    return () => {
      cancelled = true
      if (!scanner) return
      const instance = scanner
      const finish = () => {
        try {
          instance.clear()
        } catch {
          /* already cleared */
        }
      }
      // html5-qrcode throws *synchronously* from stop() when the scanner never
      // started (camera denied, no camera, or still starting). An exception
      // escaping an effect cleanup tears down the whole React tree, so guard it.
      try {
        void Promise.resolve(instance.stop())
          .catch(() => undefined)
          .finally(finish)
      } catch {
        finish()
      }
    }
  }, [onResult])

  return (
    <>
      <div className="scanner">
        <div id={SCANNER_ID} />
      </div>
      <p className="scanner__hint">
        <CameraIcon size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        Point the camera at the other person’s QR code.
      </p>

      {error && <p className="error-text">{error}</p>}

      <div className="field">
        <label htmlFor="scan-manual">No camera? Type their username</label>
        <div className="link-box" style={{ background: 'var(--panel)' }}>
          <input
            id="scan-manual"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            placeholder="alex_92"
            autoCapitalize="none"
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              padding: '4px 0',
            }}
          />
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => {
              const username = normalizeUsername(manual)
              if (username) onResult(username)
            }}
          >
            Chat
          </button>
        </div>
      </div>
    </>
  )
}

function cameraMessage(caught: unknown): string {
  const raw = caught instanceof Error ? caught.message : String(caught)
  const text = raw.toLowerCase()
  if (text.includes('permission') || text.includes('notallowed')) {
    return 'Camera permission was denied. Allow camera access in your browser, or type the username below.'
  }
  if (text.includes('notfound') || text.includes('no camera') || text.includes('devices')) {
    return 'No camera found on this device. Type the username below instead.'
  }
  if (text.includes('secure') || text.includes('https')) {
    return 'The camera only works over HTTPS or on localhost. Type the username below instead.'
  }
  return `Camera could not start (${raw}). Type the username below instead.`
}
