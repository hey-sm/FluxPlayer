export function clampUpdaterProgress(percent: number | null | undefined): number {
  return Math.max(0, Math.min(100, percent ?? 0))
}
