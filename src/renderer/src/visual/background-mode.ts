export type BackgroundMode = 'dynamic' | 'wallpaper'

export function parseBackgroundMode(value: unknown): BackgroundMode | null {
  return value === 'dynamic' || value === 'wallpaper' ? value : null
}
