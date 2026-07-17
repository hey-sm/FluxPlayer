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

export interface ThemeStoreState {
  selectedPresetId: ThemePresetId
  visualParams: ThemeVisualParams
  hydrated: boolean
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
    hydrated: autoRestore,
    restore() {
      const snapshot = loadPersistedTheme(storage) ?? snapshotFromPreset()
      applyThemeVariables(snapshot.visualParams, getStyleTarget())
      savePersistedTheme(snapshot, storage)
      set({
        selectedPresetId: snapshot.selectedPresetId,
        visualParams: { ...snapshot.visualParams },
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
