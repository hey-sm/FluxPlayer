import type { VisualParams } from '../bus'
import {
  createVisualBusDiyParamsAdapter,
  type DiyVisualParamsAdapter,
} from './adapter'
import {
  getBrowserDiyVisualParamsStorage,
  loadDiyVisualParams,
  saveDiyVisualParams,
  type DiyVisualParamsStorage,
} from './persistence'
import {
  DEFAULT_DIY_VISUAL_PARAMS,
  equalDiyVisualParams,
  isDiyVisualParamKey,
  migrateDiyVisualParams,
  type DiyVisualParamKey,
} from './schema'

export type DiyVisualParamsListener = (
  params: Readonly<VisualParams>,
  previous: Readonly<VisualParams>,
) => void

export interface CreateDiyVisualParamsControllerOptions {
  /** Pass null to explicitly disable persistence in SSR/tests. */
  storage?: DiyVisualParamsStorage | null
  /** Injecting this port keeps tests and UI code independent from the rendering engine. */
  adapter?: DiyVisualParamsAdapter
}

function immutableParams(params: unknown): Readonly<VisualParams> {
  return Object.freeze(migrateDiyVisualParams(params))
}

/**
 * Serializable DIY state with synchronous subscriptions and immediate VisualBus application.
 * It owns no frame loop, timer, DOM node, theme token, shader source, or rendering object.
 */
export class DiyVisualParamsController {
  private readonly storage: DiyVisualParamsStorage | null
  private readonly adapter: DiyVisualParamsAdapter
  private readonly listeners = new Set<DiyVisualParamsListener>()
  private snapshot: Readonly<VisualParams>

  constructor(options: CreateDiyVisualParamsControllerOptions = {}) {
    this.storage =
      options.storage === undefined ? getBrowserDiyVisualParamsStorage() : options.storage
    this.adapter = options.adapter ?? createVisualBusDiyParamsAdapter()
    this.snapshot = immutableParams(loadDiyVisualParams(this.storage))

    // Hydration is applied before consumers render, and old/raw payloads are rewritten as v1.
    this.adapter.apply(this.snapshot)
    saveDiyVisualParams(this.snapshot, this.storage)
  }

  getSnapshot(): Readonly<VisualParams> {
    return this.snapshot
  }

  getParams(): Readonly<VisualParams> {
    return this.snapshot
  }

  subscribe(listener: DiyVisualParamsListener): () => void {
    this.listeners.add(listener)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.listeners.delete(listener)
    }
  }

  setParam<Key extends DiyVisualParamKey>(key: Key, value: unknown): Readonly<VisualParams> {
    if (!isDiyVisualParamKey(key)) return this.snapshot
    return this.setParams({ [key]: value })
  }

  setParams(patch: Partial<VisualParams>): Readonly<VisualParams>
  setParams(patch: unknown): Readonly<VisualParams>
  setParams(patch: unknown): Readonly<VisualParams> {
    const next = migrateDiyVisualParams(patch, this.snapshot)
    return this.commit(next, true, false)
  }

  patch(patch: Partial<VisualParams>): Readonly<VisualParams>
  patch(patch: unknown): Readonly<VisualParams>
  patch(patch: unknown): Readonly<VisualParams> {
    return this.setParams(patch)
  }

  restore(): Readonly<VisualParams> {
    return this.commit(loadDiyVisualParams(this.storage), true, true)
  }

  reset(): Readonly<VisualParams> {
    return this.commit(DEFAULT_DIY_VISUAL_PARAMS, true, true)
  }

  dispose(): void {
    this.listeners.clear()
  }

  private commit(
    params: unknown,
    persist: boolean,
    forceApply: boolean,
  ): Readonly<VisualParams> {
    const next = immutableParams(params)
    const previous = this.snapshot
    const changed = !equalDiyVisualParams(next, previous)

    if (!changed && !forceApply) return previous

    if (changed) this.snapshot = next
    const committed = this.snapshot

    // This is deliberately the sole output path; the adapter delegates to VisualBus.setParams().
    this.adapter.apply(committed)
    if (persist) saveDiyVisualParams(committed, this.storage)

    if (changed) {
      this.listeners.forEach((listener) => {
        try {
          listener(committed, previous)
        } catch (error) {
          console.error('[DiyVisualParamsController] listener failed:', error)
        }
      })
    }

    return committed
  }
}

export function createDiyVisualParamsController(
  options: CreateDiyVisualParamsControllerOptions = {},
): DiyVisualParamsController {
  return new DiyVisualParamsController(options)
}
