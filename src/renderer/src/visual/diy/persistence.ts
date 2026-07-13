import type { VisualParams } from '../bus'
import {
  DEFAULT_DIY_VISUAL_PARAMS,
  migrateDiyVisualParams,
  parseDiyVisualParams,
} from './schema'

export const DIY_VISUAL_PARAMS_PERSISTENCE_KEY = 'fluxplayer-visual-diy-params-v1'
export const DIY_VISUAL_PARAMS_PERSISTENCE_VERSION = 1 as const

export interface DiyVisualParamsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PersistedDiyVisualParamsV1 {
  version: typeof DIY_VISUAL_PARAMS_PERSISTENCE_VERSION
  params: VisualParams
}

function isDiyVisualParamsStorage(value: unknown): value is DiyVisualParamsStorage {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<DiyVisualParamsStorage>
  return typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function'
}

/** localStorage may be absent, denied, or exposed through a throwing getter. */
export function getBrowserDiyVisualParamsStorage(): DiyVisualParamsStorage | null {
  try {
    const candidate = (globalThis as { localStorage?: unknown }).localStorage
    return isDiyVisualParamsStorage(candidate) ? candidate : null
  } catch {
    return null
  }
}

export function serializeDiyVisualParams(params: Readonly<VisualParams>): string {
  const payload: PersistedDiyVisualParamsV1 = {
    version: DIY_VISUAL_PARAMS_PERSISTENCE_VERSION,
    params: migrateDiyVisualParams(params),
  }
  return JSON.stringify(payload)
}

export function deserializeDiyVisualParams(raw: string | null | undefined): VisualParams {
  return parseDiyVisualParams(raw)
}

export function loadDiyVisualParams(
  storage: DiyVisualParamsStorage | null = getBrowserDiyVisualParamsStorage(),
): VisualParams {
  if (!storage) return { ...DEFAULT_DIY_VISUAL_PARAMS }

  try {
    return deserializeDiyVisualParams(storage.getItem(DIY_VISUAL_PARAMS_PERSISTENCE_KEY))
  } catch {
    return { ...DEFAULT_DIY_VISUAL_PARAMS }
  }
}

export function saveDiyVisualParams(
  params: Readonly<VisualParams>,
  storage: DiyVisualParamsStorage | null = getBrowserDiyVisualParamsStorage(),
): boolean {
  if (!storage) return false

  try {
    storage.setItem(DIY_VISUAL_PARAMS_PERSISTENCE_KEY, serializeDiyVisualParams(params))
    return true
  } catch {
    return false
  }
}
