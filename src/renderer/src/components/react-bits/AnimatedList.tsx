/*
 * Adapted from React Bits AnimatedList at commit 8d1c5fa9.
 * Copyright (c) 2026 David Haz. MIT + Commons Clause; see THIRD_PARTY_NOTICES.md.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, Key, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { gsap, motionDurations, motionEases, useGSAP, useReducedMotion } from '../../motion'

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
  getKey(item: T, index: number): Key
  renderItem(item: T, index: number, state: AnimatedListRenderState): ReactNode
  onItemSelect?(item: T, index: number): void
  onItemIntent?(item: T, index: number): void
  selectedKey?: Key | null
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

// Upstream animates every row with `whileInView` (scale 0.7 → 1, `once: false`) against the scroll
// container, so rows pop in and back out as they cross the viewport instead of animating once on mount.
// GSAP has no `whileInView`, so the same contract is rebuilt on an IntersectionObserver rooted at the
// scroll element.
const ROW_IN_VIEW_RATIO = 0.45
const ROW_HIDDEN_SCALE = 0.7
const ROW_IN_VIEW_DURATION = 0.2
const ROW_IN_VIEW_DELAY = 0.04

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
  className,
  itemClassName,
  getItemAriaLabel,
  showGradients = true,
  displayScrollbar = false,
  enableArrowNavigation = true,
  virtualization,
}: AnimatedListProps<T>): JSX.Element {
  const shellRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const topGradientRef = useRef<HTMLDivElement>(null)
  const bottomGradientRef = useRef<HTMLDivElement>(null)
  const rowObserverRef = useRef<IntersectionObserver | null>(null)
  const reducedMotion = useReducedMotion()
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

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
  const visibleKeySignature = visibleItems
    .map((item, relativeIndex) => String(getKey(item, windowSlice.start + relativeIndex)))
    .join('\u001f')

  const updateGradients = useCallback(
    (list: HTMLDivElement): void => {
      if (!showGradients) return
      const bottomDistance = list.scrollHeight - list.scrollTop - list.clientHeight
      const topOpacity = Math.min(Math.max(list.scrollTop / 40, 0), 1)
      const bottomOpacity =
        list.scrollHeight <= list.clientHeight ? 0 : Math.min(Math.max(bottomDistance / 60, 0), 1)
      const targets = [topGradientRef.current, bottomGradientRef.current].filter(
        (element): element is HTMLDivElement => Boolean(element),
      )
      if (!targets.length) return
      if (reducedMotion) {
        gsap.set(topGradientRef.current, { opacity: topOpacity })
        gsap.set(bottomGradientRef.current, { opacity: bottomOpacity })
        return
      }
      gsap.to(topGradientRef.current, {
        opacity: topOpacity,
        duration: motionDurations.base,
        ease: motionEases.standard,
        overwrite: 'auto',
      })
      gsap.to(bottomGradientRef.current, {
        opacity: bottomOpacity,
        duration: motionDurations.base,
        ease: motionEases.standard,
        overwrite: 'auto',
      })
    },
    [reducedMotion, showGradients],
  )

  useEffect(() => {
    if (listRef.current) updateGradients(listRef.current)
  }, [items.length, updateGradients, viewportHeight])

  const applyRowVisibility = useCallback((entries: IntersectionObserverEntry[]): void => {
    for (const entry of entries) {
      const element = entry.target as HTMLElement
      const inView = entry.isIntersecting
      // The observer re-reports every row whenever the visible window is re-observed; only rows whose
      // state actually flipped are worth a tween.
      if (element.dataset.animatedListInView === String(inView)) continue
      element.dataset.animatedListInView = String(inView)
      gsap.to(element, {
        scale: inView ? 1 : ROW_HIDDEN_SCALE,
        opacity: inView ? 1 : 0,
        duration: ROW_IN_VIEW_DURATION,
        delay: inView ? ROW_IN_VIEW_DELAY : 0,
        ease: motionEases.standard,
        overwrite: 'auto',
      })
    }
  }, [])

  useEffect(() => {
    const list = listRef.current
    if (!list || reducedMotion) return
    const observer = new IntersectionObserver(applyRowVisibility, {
      root: list,
      threshold: ROW_IN_VIEW_RATIO,
    })
    rowObserverRef.current = observer
    return () => {
      observer.disconnect()
      rowObserverRef.current = null
    }
  }, [applyRowVisibility, reducedMotion])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    const elements = Array.from(shell.querySelectorAll<HTMLElement>('[data-animated-list-item]'))
    if (reducedMotion) {
      gsap.set(elements, { scale: 1, opacity: 1 })
      return
    }
    const observer = rowObserverRef.current
    for (const element of elements) {
      if (element.dataset.animatedListInView === undefined) {
        element.dataset.animatedListInView = 'false'
        gsap.set(element, { scale: ROW_HIDDEN_SCALE, opacity: 0 })
      }
      observer?.observe(element)
    }
    return () => {
      // Only stop observing: rows that survive a window change keep their in-flight pop-in tween.
      for (const element of elements) observer?.unobserve(element)
    }
  }, [reducedMotion, visibleKeySignature])

  useGSAP(
    () => {
      const elements = gsap.utils.toArray<HTMLElement>('[data-animated-list-item]', shellRef.current)
      for (const element of elements) {
        const selected = element.dataset.selected === 'true'
        const focused = element.dataset.focused === 'true'
        const x = selected ? 4 : focused ? 2 : 0
        const previousX = element.dataset.animatedListMotionX
        if (previousX === String(x)) continue
        element.dataset.animatedListMotionX = String(x)
        if (previousX === undefined && x === 0) continue
        if (reducedMotion) gsap.set(element, { x })
        else {
          gsap.to(element, {
            x,
            duration: motionDurations.fast,
            ease: motionEases.standard,
            overwrite: 'auto',
          })
        }
      }
      return () => gsap.killTweensOf(elements)
    },
    {
      scope: shellRef,
      dependencies: [focusedIndex, reducedMotion, selectedKey, visibleKeySignature],
      // The row offset is diffed against the last applied value, so reverting on update would strip the
      // inline transform while the dataset still claims it is applied — selection would stop nudging.
    },
  )

  const scrollToIndex = useCallback(
    (index: number): void => {
      const list = listRef.current
      if (!list) return
      if (virtualization) {
        const top = index * virtualization.rowHeight
        const bottom = top + virtualization.rowHeight
        if (top < list.scrollTop) list.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' })
        else if (bottom > list.scrollTop + list.clientHeight) {
          list.scrollTo({
            top: bottom - list.clientHeight,
            behavior: reducedMotion ? 'auto' : 'smooth',
          })
        }
        return
      }
      list.querySelector<HTMLElement>(`[data-animated-list-index="${index}"]`)?.scrollIntoView({
        block: 'nearest',
        behavior: reducedMotion ? 'auto' : 'smooth',
      })
    },
    [reducedMotion, virtualization],
  )

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
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
    <div ref={shellRef} className={cn('relative min-h-0', className)} data-animated-list="">
      <div
        ref={listRef}
        className={cn(
          'size-full overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color-mix(in_srgb,var(--flux-accent)_52%,transparent)]',
          !displayScrollbar && '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
        role="group"
        aria-label={ariaLabel}
        tabIndex={enableArrowNavigation ? 0 : undefined}
        data-scroll-region
        data-animated-list-scroll=""
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
            <button
              key={key}
              type="button"
              tabIndex={-1}
              data-animated-list-item=""
              data-animated-list-index={index}
              data-animated-list-key={String(key)}
              data-selected={state.selected || undefined}
              data-focused={state.focused || undefined}
              className={cn('w-full', resolvedClassName)}
              style={virtualization ? { height: virtualization.rowHeight } : undefined}
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
            </button>
          )
        })}
        {windowSlice.offsetBottom > 0 ? (
          <div aria-hidden="true" style={{ height: windowSlice.offsetBottom }} />
        ) : null}
      </div>
      {showGradients ? (
        <>
          <div
            ref={topGradientRef}
            className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-9 bg-[linear-gradient(to_bottom,var(--flux-glass-background),transparent)] opacity-0"
            aria-hidden="true"
            data-animated-list-gradient="top"
          />
          <div
            ref={bottomGradientRef}
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-16 bg-[linear-gradient(to_top,var(--flux-glass-background),transparent)] opacity-0"
            aria-hidden="true"
            data-animated-list-gradient="bottom"
          />
        </>
      ) : null}
    </div>
  )
}
