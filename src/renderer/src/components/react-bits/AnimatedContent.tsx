/*
 * Adapted from React Bits AnimatedContent at commit 8d1c5fa9.
 * Copyright (c) 2026 David Haz. MIT + Commons Clause; see THIRD_PARTY_NOTICES.md.
 */
import { useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'

export interface AnimatedContentProps extends React.HTMLAttributes<HTMLDivElement> {
  visible: boolean
  direction?: 'vertical' | 'horizontal'
  reverse?: boolean
  distance?: number
  enterDuration?: number
  exitDuration?: number
  enterEase?: string
  exitEase?: string
  animateOpacity?: boolean
  onEnterComplete?(): void
  onExitComplete?(): void
}

export function AnimatedContent({
  visible,
  direction = 'vertical',
  reverse = false,
  distance = 56,
  enterDuration = 0.32,
  exitDuration = 0.22,
  enterEase = 'power3.out',
  exitEase = 'power2.in',
  animateOpacity = true,
  onEnterComplete,
  onExitComplete,
  children,
  style,
  ...props
}: AnimatedContentProps): React.JSX.Element {
  const elementRef = useRef<HTMLDivElement>(null)
  const firstAnimationRef = useRef(true)

  useLayoutEffect(() => {
    const element = elementRef.current
    if (!element) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const axis = direction === 'horizontal' ? 'x' : 'y'
    const offset = (reverse ? -1 : 1) * distance
    const hiddenState = {
      [axis]: offset,
      opacity: animateOpacity ? 0 : 1,
      visibility: 'hidden',
      pointerEvents: 'none',
    }

    gsap.killTweensOf(element)
    if (reducedMotion) {
      gsap.set(
        element,
        visible ? { x: 0, y: 0, opacity: 1, visibility: 'visible', pointerEvents: 'auto' } : hiddenState,
      )
      if (visible) onEnterComplete?.()
      else onExitComplete?.()
      firstAnimationRef.current = false
      return
    }

    if (visible) {
      if (firstAnimationRef.current) {
        gsap.set(element, {
          ...hiddenState,
          visibility: 'visible',
        })
      }
      gsap.to(element, {
        x: 0,
        y: 0,
        opacity: 1,
        visibility: 'visible',
        pointerEvents: 'auto',
        duration: enterDuration,
        ease: enterEase,
        overwrite: true,
        onComplete: onEnterComplete,
      })
    } else {
      if (firstAnimationRef.current) {
        gsap.set(element, hiddenState)
        firstAnimationRef.current = false
        return
      }
      gsap.to(element, {
        [axis]: offset,
        opacity: animateOpacity ? 0 : 1,
        pointerEvents: 'none',
        duration: exitDuration,
        ease: exitEase,
        overwrite: true,
        onComplete: () => {
          gsap.set(element, { visibility: 'hidden' })
          onExitComplete?.()
        },
      })
    }
    firstAnimationRef.current = false

    return () => {
      gsap.killTweensOf(element)
    }
  }, [
    animateOpacity,
    direction,
    distance,
    enterDuration,
    enterEase,
    exitDuration,
    exitEase,
    onEnterComplete,
    onExitComplete,
    reverse,
    visible,
  ])

  return (
    <div
      ref={elementRef}
      aria-hidden={!visible || undefined}
      data-animation-direction={direction}
      data-animation-reverse={reverse}
      style={style}
      {...props}
    >
      {children}
    </div>
  )
}
