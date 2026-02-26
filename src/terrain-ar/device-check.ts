/**
 * DeviceCheck
 *
 * Detecta compatibilidad con AR, giroscopio y cámara ANTES de arrancar.
 * Muestra alertas con estilo consistente al resto de la UI.
 * Si AR no está disponible redirige a la versión 3D web.
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
  #dc-icon.warn { background: rgba(255,180,0,0.15); }
  #dc-icon.error { background: rgba(255,70,70,0.12); }

  #dc-title {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 16px; font-weight: 600;
    color: #1a2a3a; text-align: center; line-height: 1.3;
  }
  #dc-msg {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 13px; font-weight: 400;
    color: #5a6a7a; text-align: center; line-height: 1.55;
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

function injectCSS() {
  if (document.getElementById('dc-styles')) return
  const s = document.createElement('style')
  s.id = 'dc-styles'
  s.textContent = CSS
  document.head.appendChild(s)
}

function showAlert(opts: {
  icon:       string
  iconType:   'warn' | 'error'
  title:      string
  message:    string
  primary:    string
  secondary?: string
  onPrimary:  () => void
  onSecondary?: () => void
}): void {
  injectCSS()
  document.getElementById('dc-overlay')?.remove()

  const div = document.createElement('div')
  div.id = 'dc-overlay'
  div.innerHTML = `
    <div id="dc-card">
      <div id="dc-icon ${opts.iconType}">${opts.icon}</div>
      <div id="dc-title">${opts.title}</div>
      <div id="dc-msg">${opts.message}</div>
      <button id="dc-btn-primary">${opts.primary}</button>
      ${opts.secondary ? `<button id="dc-btn-secondary">${opts.secondary}</button>` : ''}
    </div>
  `
  document.body.appendChild(div)
  requestAnimationFrame(() => div.classList.add('dc-show'))

  div.querySelector('#dc-btn-primary')!.addEventListener('click', () => {
    div.classList.remove('dc-show')
    setTimeout(() => div.remove(), 320)
    opts.onPrimary()
  })
  if (opts.secondary && opts.onSecondary) {
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
 * Verifica soporte de WebXR / 8thwall AR.
 * En dispositivos sin soporte ofrece redirigir a la web 3D.
 * Returns true si el usuario decide continuar de todos modos.
 */
export function checkArSupport(): void {
  const ua      = navigator.userAgent
  const isIOS   = /iP(hone|ad|od)/.test(ua)
  const isAndroid = /Android/.test(ua)

  // iPad OS 16+ con Safari tiene limitaciones en WebXR de terceros (8thwall usa su propio pipeline)
  // 8thwall NO soporta: Firefox móvil, Opera Mini, KaiOS, navegadores in-app sin permisos de cámara
  const isSupported = (isIOS || isAndroid) && (
    /Safari/.test(ua) || /Chrome/.test(ua) || /CriOS/.test(ua)
  )

  if (!isSupported) {
    showAlert({
      icon:      '🌐',
      iconType:  'warn',
      title:     'Dispositivo no compatible con AR',
      message:   'Este dispositivo o navegador no admite experiencias AR. Puedes explorar el mapa en la versión 3D interactiva.',
      primary:   'Ver versión 3D',
      secondary: 'Continuar de todas formas',
      onPrimary: () => { window.location.href = FALLBACK_3D_URL },
      onSecondary: () => { /* user insists */ },
    })
  }
}

/**
 * Verifica si otro tab/app está usando la cámara.
 * Llama onReady cuando la cámara está disponible.
 * Llama onError con mensaje descriptivo si no.
 */
export async function checkCameraAccess(
  onReady: () => void,
  onError: (reason: 'denied' | 'inuse' | 'unknown') => void,
): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true })
    stream.getTracks().forEach(t => t.stop())  // release immediately
    onReady()
  } catch (err: any) {
    const name = (err as DOMException).name
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      onError('denied')
      showAlert({
        icon:     '📷',
        iconType: 'error',
        title:    'Acceso a cámara denegado',
        message:  'Esta experiencia AR necesita la cámara. Ve a Configuración → Privacidad → Cámara y habilita el acceso para este navegador.',
        primary:  'Entendido',
        onPrimary: () => {},
      })
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      onError('inuse')
      showAlert({
        icon:     '📷',
        iconType: 'warn',
        title:    'Cámara en uso',
        message:  'Otra aplicación está usando la cámara. Ciérrala y vuelve a intentarlo.',
        primary:  'Reintentar',
        onPrimary: () => window.location.reload(),
      })
    } else {
      onError('unknown')
    }
  }
}

/**
 * Verifica si el giroscopio está disponible y tiene datos reales.
 * Resuelve con true (gyro OK) o false (sin giroscopio).
 */
export function probeGyroscope(timeoutMs = 1500): Promise<boolean> {
  return new Promise(resolve => {
    let resolved = false
    const handler = (e: DeviceOrientationEvent) => {
      if (resolved) return
      // e.alpha null significa que no hay datos reales
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