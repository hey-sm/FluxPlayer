import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { applyThemeVariables, resolveDocumentThemeStyle, type ThemeStyleTarget } from './dom'
import { snapshotFromPreset } from './presets'
import {
  getBrowserThemeStorage,
  loadPersistedTheme,
  savePersistedTheme,
  type ThemeStorage,
} from './persistence'
import type { ThemePresetId, ThemeVisualParams } from './types'
import { normalizeHexColor } from './values'

export interface ThemeStoreState {
  selectedPresetId: ThemePresetId
  visualParams: ThemeVisualParams
  lyricsColor: string
  lyricsColorLinked: boolean
  hydrated: boolean
  setAccent(accent: string): void
  setLyricsColor(color: string): void
  setLyricsColorLinked(linked: boolean): void
  restore(): void
}

export interface CreateThemeStoreOptions {
  storage?: ThemeStorage | null
  styleTarget?: ThemeStyleTarget | null
  autoRestore?: boolean
}

export function createThemeStore(options: CreateThemeStoreOptions = {}): StoreApi<ThemeStoreState> {
  const storage = options.storage === undefined ? getBrowserThemeStorage() : options.storage
  const explicitStyleTarget = Object.prototype.hasOwnProperty.call(options, 'styleTarget')
  const getStyleTarget = (): ThemeStyleTarget | null =>
    explicitStyleTarget ? (options.styleTarget ?? null) : resolveDocumentThemeStyle()
  const autoRestore = options.autoRestore !== false
  const initialSnapshot = autoRestore
    ? (loadPersistedTheme(storage) ?? snapshotFromPreset())
    : snapshotFromPreset()
  applyThemeVariables(initialSnapshot.visualParams, getStyleTarget())
  if (autoRestore) savePersistedTheme(initialSnapshot, storage)

  return createStore<ThemeStoreState>()((set) => ({
    selectedPresetId: initialSnapshot.selectedPresetId,
    visualParams: { ...initialSnapshot.visualParams },
    lyricsColor: initialSnapshot.lyricsColor,
    lyricsColorLinked: initialSnapshot.lyricsColorLinked,
    hydrated: autoRestore,
    setAccent(accent) {
      const normalized = normalizeHexColor(accent)
      if (!normalized) return
      set((state) => {
        if (state.visualParams.accent === normalized) return state
        const visualParams = { ...state.visualParams, accent: normalized }
        const lyricsColor = state.lyricsColorLinked ? normalized : state.lyricsColor
        applyThemeVariables(visualParams, getStyleTarget())
        savePersistedTheme(
          {
            selectedPresetId: state.selectedPresetId,
            visualParams,
            lyricsColor,
            lyricsColorLinked: state.lyricsColorLinked,
          },
          storage,
        )
        return { visualParams, lyricsColor }
      })
    },
    setLyricsColor(color) {
      const normalized = normalizeHexColor(color)
      if (!normalized) return
      set((state) => {
        if (state.lyricsColor === normalized) return state
        savePersistedTheme(
          {
            selectedPresetId: state.selectedPresetId,
            visualParams: state.visualParams,
            lyricsColor: normalized,
            lyricsColorLinked: state.lyricsColorLinked,
          },
          storage,
        )
        return { lyricsColor: normalized }
      })
    },
    setLyricsColorLinked(linked) {
      set((state) => {
        if (state.lyricsColorLinked === linked) return state
        const lyricsColor = linked ? state.visualParams.accent : state.lyricsColor
        savePersistedTheme(
          {
            selectedPresetId: state.selectedPresetId,
            visualParams: state.visualParams,
            lyricsColor,
            lyricsColorLinked: linked,
          },
          storage,
        )
        return { lyricsColor, lyricsColorLinked: linked }
      })
    },
    restore() {
      const snapshot = loadPersistedTheme(storage) ?? snapshotFromPreset()
      applyThemeVariables(snapshot.visualParams, getStyleTarget())
      savePersistedTheme(snapshot, storage)
      set({
        selectedPresetId: snapshot.selectedPresetId,
        visualParams: { ...snapshot.visualParams },
        lyricsColor: snapshot.lyricsColor,
        lyricsColorLinked: snapshot.lyricsColorLinked,
        hydrated: true,
      })
    },
  }))
}

export const themeStore = createThemeStore()
type ThemeSelector<T> = (state: ThemeStoreState) => T
export function useThemeStore(): ThemeStoreState
export function useThemeStore<T>(selector: ThemeSelector<T>): T
export function useThemeStore<T>(selector?: ThemeSelector<T>): T | ThemeStoreState {
  return useStore(themeStore, (state) => (selector ? selector(state) : state))
}
