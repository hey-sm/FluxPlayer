import * as THREE from 'three'
import type { VisualPreset } from '../bus'
import { MUSIC_BACKGROUND_BY_PRESET, isMusicBackgroundPreset } from './registry'
import type {
  BackgroundPresetId,
  BackgroundUpdateFrame,
  MusicVisualBackground,
  MusicVisualBackgroundDefinition,
} from './types'

/** Lazily owns exactly one active background while keeping one stable Stage scene node. */
export class MusicBackgroundManager {
  readonly group = new THREE.Group()
  private active: MusicVisualBackground | null = null
  private activePreset: BackgroundPresetId | null = null
  private coverTexture: THREE.Texture | null = null
  private disposed = false

  constructor(
    private readonly definitions: ReadonlyMap<BackgroundPresetId, MusicVisualBackgroundDefinition> =
      MUSIC_BACKGROUND_BY_PRESET,
  ) {
    this.group.name = 'music-background-manager'
    this.group.visible = false
  }

  static supports(preset: number): preset is BackgroundPresetId {
    return isMusicBackgroundPreset(preset)
  }

  get activePresetId(): BackgroundPresetId | null {
    return this.activePreset
  }

  setPreset(preset: VisualPreset): void {
    if (this.disposed) return
    const definition = this.definitions.get(preset as BackgroundPresetId)
    if (!definition) {
      this.releaseActive()
      this.group.visible = false
      return
    }
    if (this.activePreset === definition.id && this.active) {
      this.group.visible = true
      return
    }
    this.releaseActive()
    const background = definition.create()
    this.active = background
    this.activePreset = definition.id
    background.setCoverTexture(this.coverTexture)
    this.group.add(background.group)
    this.group.visible = true
  }

  setCoverTexture(texture: THREE.Texture | null): void {
    if (this.disposed || this.coverTexture === texture) return
    this.coverTexture = texture
    this.active?.setCoverTexture(texture)
  }

  update(deltaTime: number, frame: Readonly<BackgroundUpdateFrame>): void {
    if (this.disposed || !this.group.visible) return
    this.active?.update(deltaTime, frame)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.coverTexture = null
    this.releaseActive()
    this.group.clear()
  }

  private releaseActive(): void {
    if (!this.active) {
      this.activePreset = null
      return
    }
    this.group.remove(this.active.group)
    this.active.dispose()
    this.active = null
    this.activePreset = null
  }
}
