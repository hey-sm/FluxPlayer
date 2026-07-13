export const DEFAULT_LIBRARY_PAGE_SIZE = 100
export const MAX_LIBRARY_PAGE_SIZE = 200

export interface PageRequest {
  offset?: number
  limit?: number
}

export interface NormalizedPageRequest {
  offset: number
  limit: number
}

export interface PageSlice<T> extends NormalizedPageRequest {
  items: T[]
  total: number
  hasMore: boolean
}

export function normalizePageRequest(request: PageRequest = {}): NormalizedPageRequest {
  const offset = Number.isFinite(request.offset) ? Math.max(0, Math.floor(request.offset as number)) : 0
  const limit = Number.isFinite(request.limit)
    ? Math.max(1, Math.min(MAX_LIBRARY_PAGE_SIZE, Math.floor(request.limit as number)))
    : DEFAULT_LIBRARY_PAGE_SIZE
  return { offset, limit }
}

export function slicePage<T>(items: readonly T[], request: PageRequest = {}): PageSlice<T> {
  const { offset, limit } = normalizePageRequest(request)
  const pageItems = items.slice(offset, offset + limit)
  return {
    offset,
    limit,
    items: pageItems,
    total: items.length,
    hasMore: offset + pageItems.length < items.length,
  }
}
