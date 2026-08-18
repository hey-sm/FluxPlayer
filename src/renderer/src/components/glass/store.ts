import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  DEFAULT_GLASS_CONFIG,
  equalGlassConfig,
  glassConfigToCssVariables,
  patchGlassConfig,
  type GlassConfig,
  type GlassEditablePatch,
} from './config'
import {
  getBrowserGlassStorage,
  loadPersistedGlassConfig,
  savePersistedGlassConfig,
  type GlassStorage,
} from './persistence'

export interface GlassStyleTarget {
  setProperty(name: string, value: string): void
}

export interface GlassStoreState {
  config: GlassConfig
  previewConfig(patch: GlassEditablePatch): void
  commitConfig(patch?: GlassEditablePatch): void
  resetConfig(): void
  restore(): void
}

export interface CreateGlassStoreOptions {
  storage?: GlassStorage | null
  styleTarget?: GlassStyleTarget | null
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
  autoRestore?: boolean
}

function resolveDocumentStyle(): GlassStyleTarget | null {
  try {
    const style = (globalThis as { document?: Document }).document?.documentElement.style
    return style && typeof style.setProperty === 'function' ? style : null
  } catch {
    return null
  }
}

export function applyGlassVariables(
  config: Readonly<GlassConfig>,
  styleTarget: GlassStyleTarget | null = resolveDocumentStyle(),
): boolean {
  if (!styleTarget) return false
  try {
    for (const [name, value] of Object.entries(glassConfigToCssVariables(config))) {
      styleTarget.setProperty(name, value)
    }
    return true
  } catch {
    return false
  }
}

function defaultRequestFrame(callback: FrameRequestCallback): number {
  const requestFrame = (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame })
    .requestAnimationFrame
  if (requestFrame) return requestFrame(callback)
  callback(Date.now())
  return 0
}

function defaultCancelFrame(handle: number): void {
  const cancelFrame = (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame })
    .cancelAnimationFrame
  cancelFrame?.(handle)
}

export function createGlassStore(options: CreateGlassStoreOptions = {}): StoreApi<GlassStoreState> {
  const storage = options.storage === undefined ? getBrowserGlassStorage() : options.storage
  const explicitStyleTarget = Object.prototype.hasOwnProperty.call(options, 'styleTarget')
  const getStyleTarget = (): GlassStyleTarget | null =>
    explicitStyleTarget ? (options.styleTarget ?? null) : resolveDocumentStyle()
  const requestFrame = options.requestFrame ?? defaultRequestFrame
  const cancelFrame = options.cancelFrame ?? defaultCancelFrame
  const autoRestore = options.autoRestore !== false
  const initialConfig = autoRestore
    ? (loadPersistedGlassConfig(storage) ?? { ...DEFAULT_GLASS_CONFIG })
    : { ...DEFAULT_GLASS_CONFIG }

  let pendingPatch: GlassEditablePatch | null = null
  let framePending = false
  let frameHandle = 0

  applyGlassVariables(initialConfig, getStyleTarget())
  if (autoRestore) savePersistedGlassConfig(initialConfig, storage)

  return createStore<GlassStoreState>()((set, get) => {
    const applyPreview = (): GlassConfig => {
      const patch = pendingPatch
      pendingPatch = null
      framePending = false
      if (!patch) return get().config
      const current = get().config
      const config = patchGlassConfig(current, patch)
      if (!equalGlassConfig(config, current)) {
        applyGlassVariables(config, getStyleTarget())
        set({ config })
      }
      return config
    }

    return {
      config: initialConfig,
      previewConfig(patch) {
        pendingPatch = { ...pendingPatch, ...patch }
        if (framePending) return
        framePending = true
        frameHandle = requestFrame(() => applyPreview())
      },
      commitConfig(patch) {
        if (framePending) cancelFrame(frameHandle)
        if (patch) pendingPatch = { ...pendingPatch, ...patch }
        const config = applyPreview()
        savePersistedGlassConfig(config, storage)
      },
      resetConfig() {
        if (framePending) cancelFrame(frameHandle)
        pendingPatch = null
        framePending = false
        const config = { ...DEFAULT_GLASS_CONFIG }
        applyGlassVariables(config, getStyleTarget())
        if (!equalGlassConfig(config, get().config)) set({ config })
        savePersistedGlassConfig(config, storage)
      },
      restore() {
        if (framePending) cancelFrame(frameHandle)
        pendingPatch = null
        framePending = false
        const config = loadPersistedGlassConfig(storage) ?? { ...DEFAULT_GLASS_CONFIG }
        applyGlassVariables(config, getStyleTarget())
        if (!equalGlassConfig(config, get().config)) set({ config })
      },
    }
  })
}

export const glassStore = createGlassStore()
type GlassSelector<T> = (state: GlassStoreState) => T
export function useGlassStore(): GlassStoreState
export function useGlassStore<T>(selector: GlassSelector<T>): T
export function useGlassStore<T>(selector?: GlassSelector<T>): T | GlassStoreState {
  return useStore(glassStore, (state) => (selector ? selector(state) : state))
}
