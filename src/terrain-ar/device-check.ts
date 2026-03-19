/**
 * DeviceCheck
 *
 * Changes vs previous:
 *  - checkArSupport(): fixed isIOS detection. iPadOS 13+ dropped "iPad" from
 *    the User-Agent string and now reports "Macintosh" (same as macOS desktop).
 *    The old regex /iP(hone|ad|od)/ misses every modern iPad, causing the
 *    "Device not AR compatible" alert to block the client's iPad entirely.
 *    Fix: also check for Macintosh UA + maxTouchPoints > 1.
 *
 * Camera denied bug note:
 *   The AR experience is opened via a link/button from an external site
 *   (new tab or redirect). Some browsers ask for camera permission again
 *   because the permission from a previous session may not persist.
 *   The alert below guides the user to re-grant it from browser settings.
 */

const FALLBACK_3D_URL = 'https://virtualtours.interiors3d.com/3d-model/fvg-unesco_test/fullscreen/'

const CSS = `
  #dc-overlay {
    position: fixed; inset: 0; z-index: 999999;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,8,20,0.82); backdrop-filter: blur(6px);
    opacity: 0; transition: opacity 0.3s ease; pointer-events: none;
  }
  #dc-overlay.dc-show { opacity: 1; pointer-events: all; }

  #dc-card {
    background: rgba(255,255,255,0.97);
    border-radius: 20px;
    padding: 28px 24px 22px;
    max-width: 320px; width: 88%;
    display: flex; flex-direction: column; align-items: center; gap: 14px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.28);
    transform: translateY(12px); transition: transform 0.3s ease;
  }
  #dc-overlay.dc-show #dc-card { transform: translateY(0); }

  #dc-icon {
    width: 52px; height: 52px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 26px;
  }
  #dc-icon.warn  { background: rgba(255,180,0,0.15); }
  #dc-icon.error { background: rgba(255,70,70,0.12); }

  #dc-title {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 16px; font-weight: 600;
    color: #1a2a3a; text-align: center; line-height: 1.3;
  }
  #dc-msg {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 13px; font-weight: 400;
    color: #5a6a7a; text-align: center; line-height: 1.6;
    white-space: pre-line;
  }
  #dc-divider {
    width: 100%; border: none; border-top: 1px solid rgba(0,0,0,0.08);
    margin: 0;
  }
  #dc-msg-it {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 12px; font-weight: 400;
    color: #8a9aaa; text-align: center; line-height: 1.55;
    white-space: pre-line;
  }
  #dc-btn-primary {
    width: 100%; padding: 13px;
    background: #4ab8d8; border: none; border-radius: 12px;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 14px; font-weight: 600; letter-spacing: 0.04em;
    color: #fff; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background 0.15s;
  }
  #dc-btn-primary:active { background: #37a5c5; }
  #dc-btn-secondary {
    background: none; border: none;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 12px; font-weight: 400; letter-spacing: 0.06em;
    color: #8a9aaa; text-transform: uppercase; cursor: pointer;
    padding: 4px 8px;
    -webkit-tap-highlight-color: transparent;
  }
`

function injectCSS(): void {
  if (document.getElementById('dc-styles')) return
  const s = document.createElement('style')
  s.id = 'dc-styles'
  s.textContent = CSS
  document.head.appendChild(s)
}

function showAlert(opts: {
  icon:        string
  iconType:    'warn' | 'error'
  titleEn:     string
  messageEn:   string
  messageIt:   string
  primaryEn:   string
  secondaryEn?: string
  onPrimary:   () => void
  onSecondary?: () => void
}): void {
  injectCSS()
  document.getElementById('dc-overlay')?.remove()

  const div = document.createElement('div')
  div.id = 'dc-overlay'
  div.innerHTML = `
    <div id="dc-card">
      <div id="dc-icon" class="${opts.iconType}">${opts.icon}</div>
      <div id="dc-title">${opts.titleEn}</div>
      <div id="dc-msg">${opts.messageEn}</div>
      <hr id="dc-divider">
      <div id="dc-msg-it">${opts.messageIt}</div>
      <button id="dc-btn-primary">${opts.primaryEn}</button>
      ${opts.secondaryEn ? `<button id="dc-btn-secondary">${opts.secondaryEn}</button>` : ''}
    </div>
  `
  document.body.appendChild(div)
  requestAnimationFrame(() => div.classList.add('dc-show'))

  div.querySelector('#dc-btn-primary')!.addEventListener('click', () => {
    div.classList.remove('dc-show')
    setTimeout(() => div.remove(), 320)
    opts.onPrimary()
  })
  if (opts.secondaryEn && opts.onSecondary) {
    div.querySelector('#dc-btn-secondary')!.addEventListener('click', () => {
      div.classList.remove('dc-show')
      setTimeout(() => div.remove(), 320)
      opts.onSecondary!()
    })
  }
}

export function dismissAlert(): void {
  const el = document.getElementById('dc-overlay')
  if (!el) return
  el.classList.remove('dc-show')
  setTimeout(() => el.remove(), 320)
}

// ── Public checks ─────────────────────────────────────────────────────────────

/**
 * Checks WebXR / 8th Wall AR support.
 * On unsupported devices, offers to redirect to the 3D web version.
 */
export function checkArSupport(): void {
  const ua        = navigator.userAgent

  // iPadOS 13+ dropped "iPad" from the UA and reports "Macintosh" (same as
  // macOS desktop). We distinguish it from a real Mac by checking for touch
  // support: a MacBook never has maxTouchPoints > 1, an iPad always does.
  const isIOS =
    /iP(hone|ad|od)/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)

  const isAndroid = /Android/.test(ua)

  const isSupported = (isIOS || isAndroid) && (
    /Safari/.test(ua) || /Chrome/.test(ua) || /CriOS/.test(ua)
  )

  if (!isSupported) {
    showAlert({
      icon:       '🌐',
      iconType:   'warn',
      titleEn:    'Device not AR compatible',
      messageEn:  'This device or browser does not support AR experiences. You can explore the map in the interactive 3D version.',
      messageIt:  'Questo dispositivo o browser non supporta le esperienze AR. Puoi esplorare la mappa nella versione 3D interattiva.',
      primaryEn:  'Open 3D version',
      secondaryEn:'Continue anyway',
      onPrimary:  () => { window.location.href = FALLBACK_3D_URL },
      onSecondary: () => { /* user insists */ },
    })
  }
}

/**
 * Checks camera access.
 * Handles two failure scenarios:
 *   'denied'  — user blocked or hasn't granted permission yet
 *   'inuse'   — camera is occupied by another app
 *   'unknown' — other error
 *
 * Note: When the AR experience is opened via a link from an external site,
 * the browser may prompt for camera permission again. If the user previously
 * dismissed the prompt instead of accepting, this 'denied' path will fire.
 * The message guides them to re-enable it from browser settings.
 */
export async function checkCameraAccess(
  onReady: () => void,
  onError: (reason: 'denied' | 'inuse' | 'unknown') => void,
): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true })
    stream.getTracks().forEach(t => t.stop())
    onReady()
  } catch (err: any) {
    const name = (err as DOMException).name

    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      onError('denied')
      showAlert({
        icon:      '📷',
        iconType:  'error',
        titleEn:   'Camera access denied',
        messageEn: 'This AR experience needs your camera.\n\nGo to Settings → Privacy → Camera and enable access for this browser.',
        messageIt: 'Questa esperienza AR ha bisogno della fotocamera.\n\nVai su Impostazioni → Privacy → Fotocamera e abilita l\'accesso per questo browser.',
        primaryEn: 'Got it',
        onPrimary: () => {},
      })
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      onError('inuse')
      showAlert({
        icon:      '📷',
        iconType:  'warn',
        titleEn:   'Camera in use',
        messageEn: 'Another app is using the camera.\nClose it and try again.',
        messageIt: 'Un\'altra app sta usando la fotocamera.\nChiudila e riprova.',
        primaryEn: 'Retry',
        onPrimary: () => window.location.reload(),
      })
    } else {
      onError('unknown')
    }
  }
}

/**
 * Checks if a real gyroscope is available.
 * Returns true if gyro data is detected within timeoutMs.
 */
export function probeGyroscope(timeoutMs = 1500): Promise<boolean> {
  return new Promise(resolve => {
    let resolved = false
    const handler = (e: DeviceOrientationEvent) => {
      if (resolved) return
      if (e.alpha !== null) {
        resolved = true
        window.removeEventListener('deviceorientation', handler)
        resolve(true)
      }
    }
    window.addEventListener('deviceorientation', handler)
    setTimeout(() => {
      if (!resolved) {
        resolved = true
        window.removeEventListener('deviceorientation', handler)
        resolve(false)
      }
    }, timeoutMs)
  })
}