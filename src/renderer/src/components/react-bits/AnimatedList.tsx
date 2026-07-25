/*
 * Adapted from React Bits AnimatedList at commit 8d1c5fa9.
 * Copyright (c) 2026 David Haz. MIT + Commons Clause; see THIRD_PARTY_NOTICES.md.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'

export interface AnimatedListVirtualization {
  rowHeight: number
  overscan?: number
}

export interface AnimatedListRenderState {
  selected: boolean
  focused: boolean
}

export interface AnimatedListProps<T> {
  items: readonly T[]
  getKey(item: T, index: number): React.Key
  renderItem(item: T, index: number, state: AnimatedListRenderState): React.ReactNode
  onItemSelect?(item: T, index: number): void
  onItemIntent?(item: T, index: number): void
  selectedKey?: React.Key | null
  ariaLabel: string
  className?: string
  itemClassName?: string | ((item: T, index: number, state: AnimatedListRenderState) => string)
  getItemAriaLabel?(item: T, index: number): string
  showGradients?: boolean
  displayScrollbar?: boolean
  enableArrowNavigation?: boolean
  virtualization?: AnimatedListVirtualization
}

interface WindowSlice {
  start: number
  end: number
  offsetTop: number
  offsetBottom: number
}

export function calculateAnimatedListWindow(
  count: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 3,
): WindowSlice {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0, offsetTop: 0, offsetBottom: 0 }
  const visibleStart = Math.floor(Math.max(0, scrollTop) / rowHeight)
  const visibleCount = Math.ceil(Math.max(0, viewportHeight) / rowHeight)
  const start = Math.max(0, Math.min(count, visibleStart - overscan))
  const end = Math.max(start, Math.min(count, visibleStart + visibleCount + overscan))
  return {
    start,
    end,
    offsetTop: start * rowHeight,
    offsetBottom: Math.max(0, (count - end) * rowHeight),
  }
}

export function AnimatedList<T>({
  items,
  getKey,
  renderItem,
  onItemSelect,
  onItemIntent,
  selectedKey = null,
  ariaLabel,
  className = '',
  itemClassName = '',
  getItemAriaLabel,
  showGradients = true,
  displayScrollbar = false,
  enableArrowNavigation = true,
  virtualization,
}: AnimatedListProps<T>): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [topGradientOpacity, setTopGradientOpacity] = useState(0)
  const [bottomGradientOpacity, setBottomGradientOpacity] = useState(0)

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const update = (): void => setViewportHeight(list.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(list)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (focusedIndex < items.length) return
    setFocusedIndex(items.length ? items.length - 1 : -1)
  }, [focusedIndex, items.length])

  const windowSlice = useMemo(
    () =>
      virtualization
        ? calculateAnimatedListWindow(
            items.length,
            scrollTop,
            viewportHeight,
            virtualization.rowHeight,
            virtualization.overscan,
          )
        : { start: 0, end: items.length, offsetTop: 0, offsetBottom: 0 },
    [items.length, scrollTop, viewportHeight, virtualization],
  )
  const visibleItems = items.slice(windowSlice.start, windowSlice.end)

  const updateGradients = useCallback((list: HTMLDivElement): void => {
    const bottomDistance = list.scrollHeight - list.scrollTop - list.clientHeight
    setTopGradientOpacity(Math.min(Math.max(list.scrollTop / 40, 0), 1))
    setBottomGradientOpacity(
      list.scrollHeight <= list.clientHeight ? 0 : Math.min(Math.max(bottomDistance / 60, 0), 1),
    )
  }, [])

  useEffect(() => {
    if (listRef.current) updateGradients(listRef.current)
  }, [items.length, updateGradients, viewportHeight])

  const scrollToIndex = useCallback(
    (index: number): void => {
      const list = listRef.current
      if (!list) return
      if (virtualization) {
        const top = index * virtualization.rowHeight
        const bottom = top + virtualization.rowHeight
        if (top < list.scrollTop) list.scrollTo({ top, behavior: prefersReducedMotion ? 'auto' : 'smooth' })
        else if (bottom > list.scrollTop + list.clientHeight) {
          list.scrollTo({
            top: bottom - list.clientHeight,
            behavior: prefersReducedMotion ? 'auto' : 'smooth',
          })
        }
        return
      }
      list.querySelector<HTMLElement>(`[data-animated-list-index="${index}"]`)?.scrollIntoView({
        block: 'nearest',
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      })
    },
    [prefersReducedMotion, virtualization],
  )

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!enableArrowNavigation || !items.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      const base = focusedIndex < 0 ? (delta > 0 ? -1 : items.length) : focusedIndex
      const nextIndex = Math.max(0, Math.min(items.length - 1, base + delta))
      setFocusedIndex(nextIndex)
      onItemIntent?.(items[nextIndex], nextIndex)
      scrollToIndex(nextIndex)
      return
    }
    if (event.key === 'Enter' && focusedIndex >= 0) {
      if (event.target !== event.currentTarget) return
      event.preventDefault()
      onItemSelect?.(items[focusedIndex], focusedIndex)
    }
  }

  return (
    <div className={`animated-list-shell ${className}`.trim()}>
      <div
        ref={listRef}
        className={`animated-list-scroll${displayScrollbar ? '' : ' no-scrollbar'}`}
        role="group"
        aria-label={ariaLabel}
        tabIndex={enableArrowNavigation ? 0 : undefined}
        data-scroll-region
        onKeyDown={handleKeyDown}
        onScroll={(event) => {
          const list = event.currentTarget
          setScrollTop(list.scrollTop)
          updateGradients(list)
        }}
      >
        {windowSlice.offsetTop > 0 ? (
          <div aria-hidden="true" style={{ height: windowSlice.offsetTop }} />
        ) : null}
        {visibleItems.map((item, relativeIndex) => {
          const index = windowSlice.start + relativeIndex
          const key = getKey(item, index)
          const state = { selected: key === selectedKey, focused: index === focusedIndex }
          const resolvedClassName =
            typeof itemClassName === 'function' ? itemClassName(item, index, state) : itemClassName
          return (
            <motion.button
              key={key}
              type="button"
              tabIndex={-1}
              data-animated-list-index={index}
              className={`animated-list-item ${resolvedClassName}${state.selected ? ' active' : ''}${state.focused ? ' keyboard-focused' : ''}`.trim()}
              style={virtualization ? { height: virtualization.rowHeight } : undefined}
              initial={prefersReducedMotion ? false : { scale: 0.7, opacity: 0 }}
              whileInView={prefersReducedMotion ? undefined : { scale: 1, opacity: 1 }}
              viewport={{ amount: 0.45, once: false, root: listRef }}
              transition={{ duration: 0.2, delay: prefersReducedMotion ? 0 : 0.04 }}
              aria-current={state.selected ? 'true' : undefined}
              aria-label={getItemAriaLabel?.(item, index)}
              onFocus={() => {
                setFocusedIndex(index)
                onItemIntent?.(item, index)
              }}
              onMouseEnter={() => {
                setFocusedIndex(index)
                onItemIntent?.(item, index)
              }}
              onClick={() => onItemSelect?.(item, index)}
            >
              {renderItem(item, index, state)}
            </motion.button>
          )
        })}
        {windowSlice.offsetBottom > 0 ? (
          <div aria-hidden="true" style={{ height: windowSlice.offsetBottom }} />
        ) : null}
      </div>
      {showGradients ? (
        <>
          <div
            className="animated-list-gradient top"
            aria-hidden="true"
            style={{ opacity: topGradientOpacity }}
          />
          <div
            className="animated-list-gradient bottom"
            aria-hidden="true"
            style={{ opacity: bottomGradientOpacity }}
          />
        </>
      ) : null}
    </div>
  )
}
