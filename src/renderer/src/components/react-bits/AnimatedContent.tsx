/*
 * Adapted from React Bits AnimatedContent at commit 8d1c5fa9.
 * Copyright (c) 2026 David Haz. MIT + Commons Clause; see THIRD_PARTY_NOTICES.md.
 */
import { useRef } from 'react'
import { gsap, useGSAP, useReducedMotion } from '../../motion'

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

export interface AnimatedContentMotionState {
  axis: 'x' | 'y'
  hidden: gsap.TweenVars
  shown: gsap.TweenVars
}

export function resolveAnimatedContentMotionState(
  direction: 'vertical' | 'horizontal',
  reverse: boolean,
  distance: number,
  animateOpacity: boolean,
): AnimatedContentMotionState {
  const axis = direction === 'horizontal' ? 'x' : 'y'
  const offset = (reverse ? -1 : 1) * distance
  return {
    axis,
    hidden: {
      [axis]: offset,
      opacity: animateOpacity ? 0 : 1,
      visibility: 'hidden',
      pointerEvents: 'none',
    },
    shown: {
      x: 0,
      y: 0,
      opacity: 1,
      visibility: 'visible',
      pointerEvents: 'auto',
    },
  }
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
  const callbacksRef = useRef({ onEnterComplete, onExitComplete })
  const reducedMotion = useReducedMotion()
  callbacksRef.current = { onEnterComplete, onExitComplete }

  useGSAP(
    () => {
      const element = elementRef.current
      if (!element) return

      const { axis, hidden, shown } = resolveAnimatedContentMotionState(
        direction,
        reverse,
        distance,
        animateOpacity,
      )

      gsap.killTweensOf(element)
      if (reducedMotion) {
        gsap.set(element, visible ? shown : hidden)
        if (visible) callbacksRef.current.onEnterComplete?.()
        else callbacksRef.current.onExitComplete?.()
        firstAnimationRef.current = false
        return
      }

      if (visible) {
        if (firstAnimationRef.current) {
          gsap.set(element, { ...hidden, visibility: 'visible' })
        }
        gsap.to(element, {
          ...shown,
          duration: enterDuration,
          ease: enterEase,
          overwrite: 'auto',
          onComplete: () => callbacksRef.current.onEnterComplete?.(),
        })
      } else {
        if (firstAnimationRef.current) {
          gsap.set(element, hidden)
          firstAnimationRef.current = false
          return
        }
        gsap.to(element, {
          [axis]: hidden[axis],
          opacity: animateOpacity ? 0 : 1,
          pointerEvents: 'none',
          duration: exitDuration,
          ease: exitEase,
          overwrite: 'auto',
          onComplete: () => {
            gsap.set(element, { visibility: 'hidden' })
            callbacksRef.current.onExitComplete?.()
          },
        })
      }
      firstAnimationRef.current = false

      return () => gsap.killTweensOf(element)
    },
    {
      scope: elementRef,
      dependencies: [
        animateOpacity,
        direction,
        distance,
        enterDuration,
        enterEase,
        exitDuration,
        exitEase,
        reducedMotion,
        reverse,
        visible,
      ],
      // Never revert on update: this animation tweens *from* the state the previous run left behind.
      // Reverting would snap the panel to its resting position before the enter tween starts, so the
      // slide-in would be dropped entirely.
    },
  )

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
