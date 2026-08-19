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
  const duration = Math.max(1500, Math.min(15_000, options.duration ?? 6000))
  const item: AppToast = {
    id,
    title: options.title?.trim() || '',
    message: normalized,
    tone: options.tone ?? 'info',
    duration,
  }
  useToast.setState((state) => ({ items: [...state.items.slice(-3), item] }))
  return id
}
