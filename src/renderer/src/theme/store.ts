import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { applyThemeVariables, resolveDocumentThemeStyle, type ThemeStyleTarget } from './dom'
import {
  DEFAULT_THEME_PRESET_ID,
  cloneThemeVisualParams,
  getThemePreset,
  isThemePresetId,
  snapshotFromPreset,
} from './presets'
import {
  getBrowserThemeStorage,
  loadPersistedTheme,
  savePersistedTheme,
  type ThemeStorage,
} from './persistence'
import type { ThemePresetId, ThemeSnapshot, ThemeVisualParams, ThemeVisualPatch } from './types'
import { equalThemeVisualParams, patchThemeVisualParams } from './values'

export interface ThemeStoreState {
  selectedPresetId: ThemePresetId
  visualParams: ThemeVisualParams
  customized: boolean
  hydrated: boolean
  selectPreset(id: ThemePresetId): void
  patchVisualParams(patch: ThemeVisualPatch): void
  reset(): void
  restore(): void
}

export interface CreateThemeStoreOptions {
  /** Pass null to explicitly disable persistence (useful for SSR and tests). */
  storage?: ThemeStorage | null
  /** Pass null to explicitly disable DOM writes. */
  styleTarget?: ThemeStyleTarget | null
  /** Defaults to true. False leaves `hydrated` false until restore() is called. */
  autoRestore?: boolean
}

function customizedFrom(snapshot: ThemeSnapshot): boolean {
  return !equalThemeVisualParams(
    snapshot.visualParams,
    getThemePreset(snapshot.selectedPresetId).visualParams,
  )
}

export function createThemeStore(options: CreateThemeStoreOptions = {}): StoreApi<ThemeStoreState> {
  const storage = options.storage === undefined ? getBrowserThemeStorage() : options.storage
  const explicitStyleTarget = Object.prototype.hasOwnProperty.call(options, 'styleTarget')
  const getStyleTarget = (): ThemeStyleTarget | null =>
    explicitStyleTarget ? (options.styleTarget ?? null) : resolveDocumentThemeStyle()
  const autoRestore = options.autoRestore !== false
  const fallback = snapshotFromPreset(DEFAULT_THEME_PRESET_ID)
  const restored = autoRestore ? loadPersistedTheme(storage) : null
  const initialSnapshot = restored ?? fallback

  applyThemeVariables(initialSnapshot.visualParams, getStyleTarget())

  return createStore<ThemeStoreState>()((set, get) => {
    const commit = (snapshot: ThemeSnapshot, persist = true): void => {
      const safeSnapshot: ThemeSnapshot = {
        selectedPresetId: snapshot.selectedPresetId,
        visualParams: cloneThemeVisualParams(snapshot.visualParams),
      }

      applyThemeVariables(safeSnapshot.visualParams, getStyleTarget())
      if (persist) savePersistedTheme(safeSnapshot, storage)
      set({
        selectedPresetId: safeSnapshot.selectedPresetId,
        visualParams: safeSnapshot.visualParams,
        customized: customizedFrom(safeSnapshot),
        hydrated: true,
      })
    }

    return {
      selectedPresetId: initialSnapshot.selectedPresetId,
      visualParams: cloneThemeVisualParams(initialSnapshot.visualParams),
      customized: customizedFrom(initialSnapshot),
      hydrated: autoRestore,

      selectPreset(id) {
        if (!isThemePresetId(id)) return
        commit(snapshotFromPreset(id))
      },

      patchVisualParams(patch) {
        const current = get()
        commit({
          selectedPresetId: current.selectedPresetId,
          visualParams: patchThemeVisualParams(current.visualParams, patch),
        })
      },

      reset() {
        commit(snapshotFromPreset(DEFAULT_THEME_PRESET_ID))
      },

      restore() {
        commit(loadPersistedTheme(storage) ?? snapshotFromPreset(DEFAULT_THEME_PRESET_ID), false)
      },
    }
  })
}

export const themeStore = createThemeStore()

type ThemeSelector<T> = (state: ThemeStoreState) => T

export function useThemeStore(): ThemeStoreState
export function useThemeStore<T>(selector: ThemeSelector<T>): T
export function useThemeStore<T>(selector?: ThemeSelector<T>): T | ThemeStoreState {
  return useStore(themeStore, (state) => (selector ? selector(state) : state))
}
