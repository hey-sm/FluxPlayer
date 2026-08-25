/*
 * Main-process builder + handler for the Sylva "Living Green" scene.
 *
 * The renderer mounts the scene inside an <iframe> whose `src` points at the
 * `flux-sylva://scene` document this module serves. Serving the scene through a
 * custom protocol (instead of <iframe srcDoc>) is required because:
 *
 *   - The app CSP sets `frame-src`, which only governs framed URLs; a srcdoc
 *     iframe would instead inherit the parent CSP and the scene's inline
 *     <script> bundle (the bundled Three.js r149 + ~4000 lines of scene code)
 *     would be blocked by `script-src 'self'` (no 'unsafe-inline').
 *   - A custom-protocol document is its own browsing context with its own CSP
 *     header, so the scene can ship the inline scripts it needs while the app
 *     CSP stays as restrictive as ever (it only has to allow `frame-src
 *     flux-sylva:`).
 *
 * The document is assembled once at startup from the verbatim upstream scene
 * HTML and bundled Three.js runtime, exactly the way the upstream ThreeUI
 * component isolates its scene (drop landing-page markup, keep only
 * `<canvas id="scene">` + `<div id="stage">`, inline the runtime). We only add
 * one tiny pointer-bridge script so the host can forward mouse parallax into
 * the iframe via postMessage (the iframe origin differs from `flux://app`, so
 * direct contentWindow access is cross-origin; postMessage is not).
 *
 * License: MIT (ThreeUI / MengTo). See THIRD_PARTY_NOTICES.md.
 */
import sceneSourceHtml from './scene-source.html?raw'
import threeRuntimeJs from './three-r149.min.js?raw'

const SCENE_LABEL = 'Interactive procedural moss root world'

const SCENE_ONLY_MARKUP = `<main class="hero" id="hero">
  <canvas id="scene" role="img" aria-label="${SCENE_LABEL}"></canvas>
  <div class="stage" id="stage" aria-hidden="true"></div>
</main>`

const SCENE_ONLY_STYLE = `<style data-flux-sylva-scene>
html,
body {
  width: 100% !important;
  height: 100% !important;
  min-height: 0 !important;
  margin: 0 !important;
  overflow: hidden !important;
}

body {
  position: relative !important;
  background: #4a4d44 !important;
}

.hero {
  height: 100% !important;
  min-height: 0 !important;
}

#scene {
  pointer-events: auto !important;
}
</style>`

// The host forwards pointer parallax as postMessage({type:'sylva-pointer',...}).
// The scene's own handlers are bound on the iframe's window, so the bridge
// re-dispatches synthetic PointerEvents there. Coordinates are normalised
// (0..1) and converted to the iframe's client space using its own inner size,
// which matches the hero rect the scene measures (the hero fills the iframe).
const POINTER_BRIDGE = `<script data-flux-sylva-pointer-bridge>
(function () {
  function fire(type, x, y) {
    var w = window.innerWidth, h = window.innerHeight;
    var ev = new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerType: 'mouse', pointerId: 1,
      clientX: x * w, clientY: y * h,
      screenX: x * w, screenY: y * h
    });
    window.dispatchEvent(ev);
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 'sylva-pointer') return;
    if (d.active) fire('pointermove', d.x, d.y);
    else window.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }));
  });
})();
</script>`

const PRESENTATION_START = '<main class="hero" id="hero">'
const RUNTIME_START = '<script src="inner-green-assets/three.min.js"></script>'

let cachedDocument: string | null = null

// NOTE: the Three.js runtime contains literal `$'`, `$1` and other dollar
// sequences (three-r149 has `.replace('WC', ah) + '$'`). String.prototype.replace
// treats `$'`, `` $` ``, `$&`, `$1`... in the *replacement* string as special
// patterns, so feeding the runtime as a replace() replacement corrupts the
// document at the first such sequence: `$'` splices in everything after the
// match, mangling the inline script. Build the document with plain
// indexOf + slice concatenation instead.
function buildSylvaSceneDocument(): string {
  if (cachedDocument !== null) return cachedDocument
  const presentationStart = sceneSourceHtml.indexOf(PRESENTATION_START)
  const runtimeStart = sceneSourceHtml.indexOf(RUNTIME_START)
  if (presentationStart < 0 || runtimeStart < 0 || runtimeStart <= presentationStart) {
    throw new Error('Sylva scene adapter could not isolate the authored Three.js scene.')
  }

  // head + scene-only markup, then the runtime tag onwards.
  const beforeRuntime =
    sceneSourceHtml.slice(0, presentationStart) +
    SCENE_ONLY_MARKUP +
    '\n\n' +
    sceneSourceHtml.slice(runtimeStart)
  const rtTagIdx = beforeRuntime.indexOf(RUNTIME_START)
  if (rtTagIdx < 0) throw new Error('Sylva scene adapter could not find the runtime tag after isolation.')
  const afterTag = beforeRuntime.slice(rtTagIdx + RUNTIME_START.length)
  // Inline the Three.js runtime verbatim (no $-interpolation) with the pointer
  // bridge placed just before it.
  const withRuntime =
    beforeRuntime.slice(0, rtTagIdx) +
    POINTER_BRIDGE +
    '\n' +
    '<script data-flux-sylva-three-runtime>' +
    threeRuntimeJs +
    '</script>' +
    afterTag
  // Inject the scene-only style before </head> via slice (avoids replace()).
  const headClose = withRuntime.indexOf('</head>')
  if (headClose < 0) throw new Error('Sylva scene adapter could not find </head>.')
  cachedDocument = withRuntime.slice(0, headClose) + SCENE_ONLY_STYLE + withRuntime.slice(headClose)
  return cachedDocument
}

// The scene document runs the bundled Three.js r149 and ~4000 lines of inline
// scene code, so it needs inline scripts. It loads no remote content, makes no
// network requests, and is served only to our own iframe, so 'unsafe-inline'
// for scripts is the minimal, scoped relaxation; everything else is locked
// down (no remote frames, connections, images, or styles).
//
// frame-ancestors: this document is MEANT to be framed by the app window, so
// it must allow the app origin. dev runs at http://localhost:* (Vite); prod
// runs at flux://app. 'none' here would block the app from embedding it —
// which is exactly the blank-iframe bug this line caused before.
const SYLVA_SCENE_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  'frame-ancestors flux://app http://localhost:*',
  "form-action 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
].join('; ')

function sylvaRequestTarget(requestUrl: string): 'scene' | null {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== 'flux-sylva:' || url.username || url.password || url.port) return null
    const host = url.hostname
    if ((host === 'scene' || host === 'scene.local') && (url.pathname === '' || url.pathname === '/')) {
      return url.search || url.hash ? null : 'scene'
    }
    return null
  } catch {
    return null
  }
}

export function handleSylvaRequest(request: Request): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    console.warn('[flux-sylva] method not allowed', request.method, request.url)
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }
  const target = sylvaRequestTarget(request.url)
  if (!target) {
    console.warn('[flux-sylva] not found', request.url)
    return new Response('Not found', { status: 404 })
  }
  let body: string
  try {
    body = buildSylvaSceneDocument()
  } catch (error) {
    console.error('[flux-sylva] scene document build failed', error)
    return new Response('Scene unavailable', { status: 500 })
  }
  console.info('[flux-sylva] serving scene', request.url, body.length, 'bytes')
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': SYLVA_SCENE_CSP,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Opener-Policy': 'same-origin',
  })
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
  return new Response(body, { status: 200, headers })
}
