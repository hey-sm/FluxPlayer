import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  WallpaperEngineProject,
  WallpaperEngineRuntimeStatus,
  WallpaperEngineSelection,
} from '@shared/wallpaper-engine-contract'
import { cn } from '../../lib/utils'

interface GlassClipRect {
  id: string
  x: number
  y: number
  width: number
  height: number
  radius: number
}

export interface WallpaperEngineLayerProps {
  project: WallpaperEngineProject | null
  selection: WallpaperEngineSelection
  runtimeStatus: WallpaperEngineRuntimeStatus
  suspended: boolean
  onReadyChange(ready: boolean): void
  onFailure(projectId: string, error: string): void
}

function visibleGlassRects(): GlassClipRect[] {
  return [...document.querySelectorAll<HTMLElement>('[data-flux-glass-surface]')]
    .filter((element) => {
      const sheet = element.closest<HTMLElement>('[data-edge-sheet]')
      if (sheet?.getAttribute('aria-hidden') === 'true') return false
      const style = getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0
    })
    .map((element, index) => {
      const bounds = element.getBoundingClientRect()
      return {
        id: `${index}:${Math.round(bounds.x)}:${Math.round(bounds.y)}`,
        x: Math.max(0, bounds.x),
        y: Math.max(0, bounds.y),
        width: Math.max(0, Math.min(window.innerWidth - bounds.x, bounds.width)),
        height: Math.max(0, Math.min(window.innerHeight - bounds.y, bounds.height)),
        radius: Math.max(0, Number.parseFloat(getComputedStyle(element).borderRadius) || 0),
      }
    })
    .filter((rect) => rect.width > 0 && rect.height > 0)
}

function useGlassClipRects(active: boolean): GlassClipRect[] {
  const [rects, setRects] = useState<GlassClipRect[]>([])

  useLayoutEffect(() => {
    if (!active) {
      setRects([])
      return
    }
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const next = visibleGlassRects()
        setRects((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
      })
    }
    const resizeObserver = new ResizeObserver(update)
    const mutationObserver = new MutationObserver((records) => {
      if (
        records.every(
          (record) =>
            record.target instanceof Element &&
            Boolean(record.target.closest('[data-wallpaper-engine-glass-sampler-root]')),
        )
      )
        return
      document
        .querySelectorAll<HTMLElement>('[data-flux-glass-surface]')
        .forEach((element) => resizeObserver.observe(element))
      update()
    })
    document
      .querySelectorAll<HTMLElement>('[data-flux-glass-surface]')
      .forEach((element) => resizeObserver.observe(element))
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-hidden', 'data-state'],
    })
    window.addEventListener('resize', update)
    update()
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [active])

  return rects
}

function DwmGlassSampler({ sessionId, suspended }: { sessionId: string; suspended: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const rects = useGlassClipRects(ready)

  useEffect(() => {
    const desktop = window.fluxDesktop
    const video = videoRef.current
    if (!desktop || !video || !sessionId) return
    let cancelled = false
    let stream: MediaStream | null = null
    void desktop
      .prepareWallpaperEngineGlassSampler(sessionId)
      .then(async (prepared) => {
        if (!prepared || cancelled) throw new Error('WALLPAPER_ENGINE_GLASS_SAMPLER_UNAVAILABLE')
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        video.srcObject = stream
        video.muted = true
        await video.play()
      })
      .catch(() => {
        if (!cancelled) setReady(false)
      })
    return () => {
      cancelled = true
      setReady(false)
      stream?.getTracks().forEach((track) => track.stop())
      video.pause()
      video.srcObject = null
    }
  }, [sessionId])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !ready) return
    if (suspended) video.pause()
    else void video.play().catch(() => undefined)
  }, [ready, suspended])

  return (
    <div className="contents" data-wallpaper-engine-glass-sampler-root="">
      <svg className="pointer-events-none fixed size-0" aria-hidden="true">
        <defs>
          <clipPath id="flux-dwm-glass-clip" clipPathUnits="userSpaceOnUse">
            {rects.map((rect) => (
              <rect
                key={rect.id}
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                rx={rect.radius}
                ry={rect.radius}
              />
            ))}
          </clipPath>
        </defs>
      </svg>
      <video
        ref={videoRef}
        muted
        playsInline
        aria-hidden="true"
        data-wallpaper-engine-glass-sampler=""
        data-ready={ready || undefined}
        className="pointer-events-none fixed inset-0 z-0 size-full object-fill"
        style={{ clipPath: 'url(#flux-dwm-glass-clip)', visibility: ready ? 'visible' : 'hidden' }}
        onCanPlay={() => setReady(true)}
        onError={() => setReady(false)}
      />
    </div>
  )
}

export function WallpaperEngineLayer({
  project,
  selection,
  runtimeStatus,
  suspended,
  onReadyChange,
  onFailure,
}: WallpaperEngineLayerProps): React.JSX.Element | null {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [mediaReady, setMediaReady] = useState(false)
  const dwmActive =
    selection.active &&
    selection.kind === 'engine' &&
    runtimeStatus.active &&
    runtimeStatus.mode === 'dwm' &&
    runtimeStatus.phase === 'active' &&
    runtimeStatus.projectId === selection.id

  useEffect(() => {
    setMediaReady(false)
    onReadyChange(dwmActive)
  }, [dwmActive, onReadyChange, project?.mediaUrl, selection.id])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !mediaReady) return
    if (suspended) video.pause()
    else void video.play().catch(() => undefined)
  }, [mediaReady, suspended])

  useEffect(() => {
    if (selection.active && selection.kind === 'media' && project?.id === selection.id && !project.mediaUrl) {
      onFailure(selection.id, 'WALLPAPER_ENGINE_MEDIA_UNAVAILABLE')
    }
  }, [onFailure, project, selection.active, selection.id, selection.kind])

  if (dwmActive) {
    return runtimeStatus.glassSamplerAvailable ? (
      <DwmGlassSampler sessionId={runtimeStatus.sessionId} suspended={suspended} />
    ) : null
  }
  if (!selection.active || selection.kind !== 'media' || !project || project.id !== selection.id) return null
  if (!project.mediaUrl) return null

  const markReady = () => {
    setMediaReady(true)
    onReadyChange(true)
  }
  const fail = () => {
    setMediaReady(false)
    onReadyChange(false)
    onFailure(selection.id, 'WALLPAPER_ENGINE_MEDIA_UNAVAILABLE')
  }

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-0',
        'transition-opacity duration-500 ease-out motion-reduce:transition-none',
        mediaReady && 'opacity-100',
      )}
      aria-hidden="true"
      data-wallpaper-engine-layer=""
      data-wallpaper-engine-kind={project.mediaType ?? 'image'}
    >
      {project.mediaType === 'video' ? (
        <video
          ref={videoRef}
          key={project.mediaUrl}
          src={project.mediaUrl}
          muted
          loop
          playsInline
          preload="auto"
          className="size-full object-cover"
          onCanPlay={markReady}
          onError={fail}
        />
      ) : (
        <img
          key={project.mediaUrl}
          src={project.mediaUrl}
          alt=""
          decoding="async"
          className="size-full object-cover"
          onLoad={markReady}
          onError={fail}
        />
      )}
    </div>
  )
}
