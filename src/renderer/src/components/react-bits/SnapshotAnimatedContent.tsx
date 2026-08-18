import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { gsap, useReducedMotion } from '../../motion'

const SNAPSHOT_TIMELINE_DURATION = 1_000

interface SnapshotAnimationRun {
  transition?: ViewTransition
  pseudoAnimation?: Animation
  tween?: gsap.core.Tween
}

let activeViewTransition: ViewTransition | null = null

export interface SnapshotAnimatedContentProps extends React.HTMLAttributes<HTMLDivElement> {
  visible: boolean
  transitionName: string
  direction?: 'vertical' | 'horizontal'
  reverse?: boolean
  distance?: number
  enterDuration?: number
  exitDuration?: number
  enterEase?: string
  exitEase?: string
  onEnterComplete?(): void
  onExitComplete?(): void
}

export function resolveSnapshotTranslate(
  direction: 'vertical' | 'horizontal',
  reverse: boolean,
  distance: number,
): string {
  const offset = (reverse ? -1 : 1) * distance
  return direction === 'horizontal' ? `${offset}px 0px` : `0px ${offset}px`
}

/**
 * Slides a rasterized View Transition snapshot so live backdrop-filter content never moves.
 * Moving the live filtered node makes Chromium rebase and resample its backdrop texture.
 */
export function SnapshotAnimatedContent({
  visible,
  transitionName,
  direction = 'vertical',
  reverse = false,
  distance = 56,
  enterDuration = 0.32,
  exitDuration = 0.22,
  enterEase = 'power3.out',
  exitEase = 'power2.in',
  onEnterComplete,
  onExitComplete,
  children,
  style,
  ...props
}: SnapshotAnimatedContentProps): React.JSX.Element {
  const elementRef = useRef<HTMLDivElement>(null)
  const presentedVisibleRef = useRef(visible)
  const activeRunRef = useRef<SnapshotAnimationRun | null>(null)
  const callbacksRef = useRef({ onEnterComplete, onExitComplete })
  const [presentedVisible, setPresentedVisible] = useState(visible)
  const reducedMotion = useReducedMotion()
  callbacksRef.current = { onEnterComplete, onExitComplete }

  useLayoutEffect(() => {
    if (visible === presentedVisibleRef.current) return
    const element = elementRef.current
    if (!element) return
    let restoreViewTransitionName = (): void => undefined

    const finish = (): void => {
      restoreViewTransitionName()
      delete element.dataset.animationState
      activeRunRef.current = null
      if (visible) callbacksRef.current.onEnterComplete?.()
      else callbacksRef.current.onExitComplete?.()
    }
    const updatePresentedVisibility = (): void => {
      presentedVisibleRef.current = visible
      setPresentedVisible(visible)
    }

    if (reducedMotion) {
      updatePresentedVisibility()
      finish()
      return
    }

    if (typeof document.startViewTransition !== 'function') {
      const run: SnapshotAnimationRun = {}
      activeRunRef.current = run
      element.dataset.animationState = visible ? 'enter' : 'exit'

      if (visible) {
        flushSync(updatePresentedVisibility)
        run.tween = gsap.fromTo(
          element,
          { autoAlpha: 0 },
          {
            autoAlpha: 1,
            duration: enterDuration,
            ease: enterEase,
            overwrite: 'auto',
            onComplete: finish,
          },
        )
      } else {
        run.tween = gsap.to(element, {
          autoAlpha: 0,
          duration: exitDuration,
          ease: exitEase,
          overwrite: 'auto',
          onComplete: () => {
            flushSync(updatePresentedVisibility)
            gsap.set(element, { autoAlpha: 1 })
            finish()
          },
        })
      }

      return () => {
        run.tween?.kill()
        gsap.set(element, { clearProps: 'opacity' })
        if (activeRunRef.current === run) activeRunRef.current = null
      }
    }

    const run: SnapshotAnimationRun = {}
    activeRunRef.current = run
    element.dataset.animationState = visible ? 'enter' : 'exit'
    activeViewTransition?.skipTransition()
    const previousViewTransitionName = element.style.viewTransitionName
    let ownsViewTransitionName = true
    element.style.viewTransitionName = transitionName
    restoreViewTransitionName = () => {
      if (!ownsViewTransitionName) return
      ownsViewTransitionName = false
      if (previousViewTransitionName) element.style.viewTransitionName = previousViewTransitionName
      else element.style.removeProperty('view-transition-name')
    }
    const transition = document.startViewTransition(() => {
      if (activeRunRef.current !== run) return
      presentedVisibleRef.current = visible
      flushSync(() => setPresentedVisible(visible))
    })
    run.transition = transition
    activeViewTransition = transition

    void transition.ready
      .then(() => {
        if (activeRunRef.current !== run) return
        const displaced = resolveSnapshotTranslate(direction, reverse, distance)
        const resting = '0px 0px'
        const keyframes: Keyframe[] = visible
          ? [
              { translate: displaced, opacity: 0 },
              { translate: resting, opacity: 1 },
            ]
          : [
              { translate: resting, opacity: 1 },
              { translate: displaced, opacity: 0 },
            ]
        const pseudoAnimation = document.documentElement.animate(keyframes, {
          duration: SNAPSHOT_TIMELINE_DURATION,
          fill: 'both',
          easing: 'linear',
          pseudoElement: `::view-transition-group(${transitionName})`,
        })
        pseudoAnimation.pause()
        pseudoAnimation.currentTime = 0
        run.pseudoAnimation = pseudoAnimation

        const driver = { currentTime: 0 }
        run.tween = gsap.to(driver, {
          currentTime: SNAPSHOT_TIMELINE_DURATION,
          duration: visible ? enterDuration : exitDuration,
          ease: visible ? enterEase : exitEase,
          overwrite: 'auto',
          onUpdate: () => {
            pseudoAnimation.currentTime = driver.currentTime
          },
          onComplete: () => {
            pseudoAnimation.finish()
            finish()
          },
        })
      })
      .catch(() => {
        if (activeRunRef.current === run) finish()
      })

    return () => {
      run.tween?.kill()
      run.pseudoAnimation?.cancel()
      run.transition?.skipTransition()
      restoreViewTransitionName()
      if (activeViewTransition === run.transition) activeViewTransition = null
      if (activeRunRef.current === run) activeRunRef.current = null
    }
  }, [
    direction,
    distance,
    enterDuration,
    enterEase,
    exitDuration,
    exitEase,
    reducedMotion,
    reverse,
    transitionName,
    visible,
  ])

  return (
    <div
      ref={elementRef}
      aria-hidden={!presentedVisible || undefined}
      data-animation-direction={direction}
      data-animation-reverse={reverse}
      data-animation-effect="snapshot-slide"
      style={{
        ...style,
        visibility: presentedVisible ? 'visible' : 'hidden',
        pointerEvents: presentedVisible ? 'auto' : 'none',
      }}
      {...props}
    >
      {children}
    </div>
  )
}
