import { GalaxyBackground } from './galaxy'
import { HtmlLightBackground } from './html-light'
import { LightRaysBackground } from './light-rays'
import type { DynamicBackgroundEffect } from './dynamic'
import type { DynamicBackgroundDefinition } from './types'

export const DYNAMIC_BACKGROUND_DEFINITIONS: readonly DynamicBackgroundDefinition[] = Object.freeze([
  Object.freeze({ effect: 'light-rays', create: () => new LightRaysBackground() }),
  Object.freeze({ effect: 'galaxy', create: () => new GalaxyBackground() }),
  Object.freeze({ effect: 'html-light', create: () => new HtmlLightBackground() }),
])

export const DYNAMIC_BACKGROUND_BY_EFFECT: ReadonlyMap<DynamicBackgroundEffect, DynamicBackgroundDefinition> =
  new Map(DYNAMIC_BACKGROUND_DEFINITIONS.map((definition) => [definition.effect, definition]))
