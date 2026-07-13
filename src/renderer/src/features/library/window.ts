export interface WindowSlice {
  start: number
  end: number
  offsetTop: number
  offsetBottom: number
}

/** Fixed-row virtualization shared by playlists, liked tracks and recent playback. */
export function calculateWindow(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 4,
): WindowSlice {
  const count = Math.max(0, Math.floor(total))
  const height = Math.max(1, rowHeight)
  const safeTop = Math.max(0, scrollTop)
  const visible = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / height))
  const extra = Math.max(0, Math.floor(overscan))
  const start = Math.max(0, Math.min(count, Math.floor(safeTop / height) - extra))
  const end = Math.max(start, Math.min(count, start + visible + extra * 2))
  return { start, end, offsetTop: start * height, offsetBottom: Math.max(0, (count - end) * height) }
}
