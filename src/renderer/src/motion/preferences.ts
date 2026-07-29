import { useSyncExternalStore } from 'react'

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function parseCssDuration(value: string, fallbackSeconds: number): number {
  const normalized = value.trim().toLowerCase()
  const amount = Number.parseFloat(normalized)
  if (!Number.isFinite(amount)) return fallbackSeconds
  if (normalized.endsWith('ms')) return amount / 1000
  if (normalized.endsWith('s')) return amount
  return fallbackSeconds
}

function durationFromToken(variable: string, fallbackSeconds: number): number {
  if (typeof document === 'undefined') return fallbackSeconds
  return parseCssDuration(
    getComputedStyle(document.documentElement).getPropertyValue(variable),
    fallbackSeconds,
  )
}

export const motionDurations = {
  get fast(): number {
    return durationFromToken('--motion-duration-fast', 0.14)
  },
  get base(): number {
    return durationFromToken('--motion-duration-base', 0.18)
  },
  get emphasized(): number {
    return durationFromToken('--motion-duration-emphasized', 0.28)
  },
} as const

export const motionEases = {
  standard: 'power2.out',
  enter: 'power3.out',
  exit: 'power2.in',
} as const

function getReducedMotionSnapshot(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function subscribeToReducedMotion(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener('change', onStoreChange)
  return () => query.removeEventListener('change', onStoreChange)
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToReducedMotion, getReducedMotionSnapshot, () => false)
}

export function durationForPreference(duration: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : duration
}
