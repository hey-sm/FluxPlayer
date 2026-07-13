export type ResourceDisposer = () => void

interface ResourceEntry {
  active: boolean
  dispose: ResourceDisposer
}

/** Owns mixed DOM, Ticker and GPU resources and releases them once in reverse order. */
export class ResourceRegistry {
  private readonly entries: ResourceEntry[] = []
  private disposed = false

  get size(): number {
    return this.entries.reduce((count, entry) => count + Number(entry.active), 0)
  }

  add(dispose: ResourceDisposer): ResourceDisposer {
    if (this.disposed) {
      dispose()
      return () => undefined
    }

    const entry: ResourceEntry = { active: true, dispose }
    this.entries.push(entry)
    return () => this.disposeEntry(entry)
  }

  track<T>(resource: T, dispose: (resource: T) => void): T {
    this.add(() => dispose(resource))
    return resource
  }

  disposeAll(): void {
    if (this.disposed) return
    this.disposed = true
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      this.disposeEntry(this.entries[index])
    }
    this.entries.length = 0
  }

  private disposeEntry(entry: ResourceEntry): void {
    if (!entry.active) return
    entry.active = false
    try {
      entry.dispose()
    } catch (error) {
      console.error('[VisualResources] dispose failed:', error)
    }
  }
}