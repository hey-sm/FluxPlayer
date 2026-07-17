import { useEffect, useRef } from 'react'
import {
  CLASSIC_GLASS_CSS_VARIABLES,
  CLASSIC_GLASS_FILTER_ID,
  CLASSIC_GLASS_MAP_ID,
  createClassicGlassDisplacementSvg,
} from '../../theme'

function supportsClassicControlGlass(): boolean {
  try {
    const probe = document.createElement('div')
    probe.style.backdropFilter = `url(#${CLASSIC_GLASS_FILTER_ID})`
    return probe.style.backdropFilter !== ''
  } catch {
    return false
  }
}

export function useClassicControlGlass(
  enabled: boolean,
  filterId = CLASSIC_GLASS_FILTER_ID,
  mapId = CLASSIC_GLASS_MAP_ID,
  readyClass = 'classic-control-glass-svg-ok',
): React.RefObject<HTMLDivElement | null> {
  const controlRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove(readyClass)
    if (!enabled || !controlRef.current) return

    for (const [name, value] of Object.entries(CLASSIC_GLASS_CSS_VARIABLES)) {
      root.style.setProperty(name, value)
    }
    if (!supportsClassicControlGlass()) return

    const control = controlRef.current
    const image = document.getElementById(mapId)
    if (!image) return
    let sizeKey = ''
    const updateMap = (): void => {
      const rect = control.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return
      const radius = Number.parseFloat(getComputedStyle(control).borderRadius) || 50
      const nextKey = `${Math.round(rect.width)}x${Math.round(rect.height)}:${Math.round(radius)}`
      if (nextKey === sizeKey) return
      sizeKey = nextKey
      const href = `data:image/svg+xml,${encodeURIComponent(
        createClassicGlassDisplacementSvg(rect.width, rect.height, radius),
      )}`
      image.setAttribute('href', href)
      image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href)
    }

    root.classList.add(readyClass)
    updateMap()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMap)
    observer?.observe(control)
    return () => {
      observer?.disconnect()
      root.classList.remove(readyClass)
    }
  }, [enabled, filterId, mapId, readyClass])

  return controlRef
}
