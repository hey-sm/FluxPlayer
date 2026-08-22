import { create } from 'zustand'

export type ToastTone = 'info' | 'warning' | 'error'

export interface AppToast {
  id: number
  title: string
  message: string
  tone: ToastTone
  duration: number
}

interface ToastState {
  items: AppToast[]
  dismiss(id: number): void
  clear(): void
}

interface ToastOptions {
  title?: string
  tone?: ToastTone
  duration?: number
}

const TONE_PRIORITY: Record<ToastTone, number> = { error: 3, warning: 2, info: 1 }

let nextToastId = 0

export const useToast = create<ToastState>((set) => ({
  items: [],
  dismiss(id) {
    set((state) => ({ items: state.items.filter((item) => item.id !== id) }))
  },
  clear() {
    set({ items: [] })
  },
}))

export function showToast(message: string, options: ToastOptions = {}): number {
  const normalized = message.trim()
  if (!normalized) return -1
  const id = ++nextToastId
  const duration = Math.max(1500, Math.min(15_000, options.duration ?? 5000))
  const item: AppToast = {
    id,
    title: options.title?.trim() || '',
    message: normalized,
    tone: options.tone ?? 'info',
    duration,
  }
  useToast.setState((state) => {
    // 同优先级最多保留 3 条，避免堆积
    const next = [...state.items, item].slice(-4)
    return { items: next }
  })
  // 自动过期
  setTimeout(() => {
    useToast.setState((state) => ({ items: state.items.filter((t) => t.id !== id) }))
  }, duration)
  return id
}

/** 按优先级排序：error > warning > info，同优先级按时间顺序（新的在后） */
export function sortToasts(items: AppToast[]): AppToast[] {
  return [...items].sort((a, b) => {
    const pa = TONE_PRIORITY[a.tone] ?? 0
    const pb = TONE_PRIORITY[b.tone] ?? 0
    if (pa !== pb) return pb - pa
    return a.id - b.id
  })
}
