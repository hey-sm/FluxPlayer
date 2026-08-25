import { CausticBackground } from './caustic'
import { CloudBackground } from './cloud'
import { HtmlLightBackground } from './html-light'
import { RainBackground } from './rain'
import { SylvaIframeBackground } from './sylva'
import type { DynamicBackgroundEffect } from './dynamic'
import type { DynamicBackgroundDefinition } from './types'

export const DYNAMIC_BACKGROUND_DEFINITIONS: readonly DynamicBackgroundDefinition[] = Object.freeze([
  Object.freeze({ effect: 'html-light', create: () => new HtmlLightBackground() }),
  Object.freeze({ effect: 'caustic', create: () => new CausticBackground() }),
  Object.freeze({ effect: 'rain', create: () => new RainBackground() }),
  Object.freeze({ effect: 'cloud', create: () => new CloudBackground() }),
  Object.freeze({ effect: 'sylva', create: () => new SylvaIframeBackground() }),
])

export const DYNAMIC_BACKGROUND_BY_EFFECT: ReadonlyMap<DynamicBackgroundEffect, DynamicBackgroundDefinition> =
  new Map(DYNAMIC_BACKGROUND_DEFINITIONS.map((definition) => [definition.effect, definition]))
