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
  exit: gsap.TweenVars
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
    exit: {
      [axis]: offset,
      opacity: animateOpacity ? 0 : 1,
      pointerEvents: 'none',
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

      const { hidden, shown, exit } = resolveAnimatedContentMotionState(
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
          gsap.set(element, hidden)
        }
        gsap.set(element, {
          visibility: 'visible',
          pointerEvents: 'auto',
          willChange: 'transform, opacity',
        })
        const tween = gsap.to(element, {
          ...shown,
          duration: enterDuration,
          ease: enterEase,
          force3D: true,
          overwrite: 'auto',
          onComplete: () => {
            gsap.set(element, { clearProps: 'willChange' })
            callbacksRef.current.onEnterComplete?.()
          },
        })
        firstAnimationRef.current = false
        return () => tween.kill()
      } else {
        if (firstAnimationRef.current) {
          gsap.set(element, hidden)
          firstAnimationRef.current = false
          return
        }
        gsap.set(element, {
          pointerEvents: 'none',
          willChange: 'transform, opacity',
        })
        const tween = gsap.to(element, {
          ...exit,
          duration: exitDuration,
          ease: exitEase,
          force3D: true,
          overwrite: 'auto',
          onComplete: () => {
            gsap.set(element, { visibility: 'hidden', clearProps: 'willChange' })
            callbacksRef.current.onExitComplete?.()
          },
        })
        firstAnimationRef.current = false
        return () => tween.kill()
      }
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
      // Never revert on update: each effect continues from the state left by its previous tween.
      // Reverting would snap the panel to rest before its next entrance begins.
    },
  )

  return (
    <div
      ref={elementRef}
      aria-hidden={!visible || undefined}
      data-animation-direction={direction}
      data-animation-reverse={reverse}
      data-animation-effect="slide"
      style={style}
      {...props}
    >
      {children}
    </div>
  )
}
