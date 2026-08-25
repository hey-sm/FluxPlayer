/*
 * Sylva "Living Green" dynamic background — faithful iframe port.
 *
 * The scene is served verbatim by the main process at the `flux-sylva://scene`
 * custom protocol (see src/main/protocols/sylva/scene-handler.ts) and mounted
 * here inside an <iframe>. Serving it through a protocol — rather than
 * <iframe srcDoc> — is what lets the scene run at all: the app CSP keeps
 * script-src strict for the host, while the protocol document carries its own
 * permissive CSP that allows the scene's inline Three.js bundle. The app CSP
 * only has to whitelist this one iframe via `frame-src flux-sylva:`.
 *
 * Integration contract:
 *   - This background's WebGL group is intentionally empty. The visible image
 *     comes from the iframe, which sits BEHIND the transparent Stage canvas.
 *     The Stage's lyrics layer renders on the canvas, on top of the iframe.
 *   - The iframe is pointer-events:none so the app UI above it keeps receiving
 *     input; mouse parallax is forwarded from the host into the iframe via
 *     postMessage, and a tiny bridge script in the scene document re-dispatches
 *     synthetic PointerEvents that hit the scene's own handlers.
 *
 * License: MIT (ThreeUI / MengTo). See THIRD_PARTY_NOTICES.md.
 */
import * as THREE from 'three'
import type { DynamicBackground } from '../types'

// Standard + secure privileged scheme (registered in registerPrivilegedSchemes).
// The scene lives at flux-sylva://scene.
const SYLVA_SCENE_URL = 'flux-sylva://scene'

export class SylvaIframeBackground implements DynamicBackground {
  readonly group = new THREE.Group()

  private iframe: HTMLIFrameElement | null = null
  private lastPointer = { x: 0.5, y: 0.5, active: false }
  private disposed = false

  constructor() {
    this.group.name = 'sylva-background'
    this.group.userData.backgroundEffect = 'sylva'
    // The group is intentionally empty: the visible scene lives in the iframe.
    // Keeping the group (and its userData tag) lets the manager/Stage treat
    // this background uniformly with the WebGL ones.
  }

  // Fixed Living Green palette — ignores the theme accent, like rain/cloud.
  setAccentColor(_color: string): void {}

  setViewport(_width: number, _height: number, _pixelRatio: number): void {
    // The iframe is sized by CSS (100% of its container) and the scene measures
    // its own canvas via the resize events it binds internally, so there is
    // nothing to do here.
  }

  setPointer(x: number, y: number, active: boolean): void {
    if (this.disposed) return
    this.lastPointer = { x, y, active }
    this.forwardPointer(active)
  }

  update(_deltaTime: number): void {
    // The scene runs its own requestAnimationFrame loop inside the iframe; the
    // shared ticker still drives every other background, so we keep the method
    // but have no work to do.
  }

  mount(container: HTMLElement): void {
    if (this.disposed || this.iframe) return
    const iframe = document.createElement('iframe')
    iframe.title = 'Interactive procedural moss root world'
    iframe.setAttribute('aria-hidden', 'true')
    iframe.setAttribute('loading', 'eager')
    // The protocol document carries its own scoped CSP that allows the scene's
    // inline scripts; no sandbox attribute — the document is a separate, trusted
    // origin served by the main process, and a sandbox would re-impose the
    // opaque-origin + inherited-CSP problem we moved to a protocol to avoid.
    iframe.src = SYLVA_SCENE_URL
    // Diagnostic: surface iframe load outcomes so a blank Sylva background can
    // be traced to a protocol/CSP/load failure rather than the scene itself.
    iframe.addEventListener('load', () => {
      console.info('[sylva] iframe loaded', SYLVA_SCENE_URL)
    })
    iframe.addEventListener('error', () => {
      console.error('[sylva] iframe failed to load', SYLVA_SCENE_URL)
    })
    Object.assign(iframe.style, {
      position: 'absolute',
      inset: '0',
      display: 'block',
      width: '100%',
      height: '100%',
      border: '0',
      // The app UI sits above the Stage canvas and must keep receiving input;
      // the scene gets pointer parallax via forwarded postMessage.
      pointerEvents: 'none',
      background: '#4a4d44',
      // The Stage canvas is a later, statically-positioned sibling; a positioned
      // element with z-index:auto paints above it. Pin the iframe to z-index:0
      // (creating a stacking context at the bottom of the container) and let the
      // Stage canvas stay above it. StageCanvas gives its canvas
      // position:relative;z-index:1 so the transparent canvas renders on top of
      // the iframe and the lyrics draw above the moss world.
      zIndex: '0',
    } satisfies Partial<CSSStyleDeclaration>)
    // Insert as the first child so the iframe is at the bottom of the DOM order
    // as well; the Stage canvas is appended afterwards by VisualStage.mount and
    // therefore renders on top.
    container.insertBefore(iframe, container.firstChild)
    this.iframe = iframe
  }

  unmount(): void {
    if (this.iframe && this.iframe.parentElement) {
      this.iframe.parentElement.removeChild(this.iframe)
    }
    this.iframe = null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unmount()
    this.group.clear()
  }

  private forwardPointer(active: boolean): void {
    const iframe = this.iframe
    const win = iframe?.contentWindow
    if (!iframe || !win) return
    // postMessage crosses origins (the iframe is flux-sylva://scene, the host is
    // flux://app), so it is the only way to reach the scene's bridge without
    // relaxing the origin isolation. The bridge in the scene document listens
    // for this exact message type.
    win.postMessage(
      {
        type: 'sylva-pointer',
        x: this.lastPointer.x,
        y: this.lastPointer.y,
        active,
      },
      // Restrict the receiver to the Sylva scene origin so a different framed
      // document cannot read the pointer. '*' is unsafe.
      'flux-sylva://scene',
    )
  }
}
