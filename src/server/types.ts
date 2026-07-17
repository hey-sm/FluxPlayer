import type { LikedTracksResult, PlaybackResolveResult } from '@shared/music-contract'
/** Provider credentials are owned by the Electron main process and never exposed to renderer code. */
export type CredentialKey = 'netease' | 'qq'

export interface CredentialStore {
  get(key: CredentialKey): string
  set(key: CredentialKey, value: string): void
}

/** Internal media resource consumed by the main-process handle registry. */
export interface UpstreamPlaybackResource {
  provider: CredentialKey
  url: string | null
  headers: Readonly<Record<string, string>>
  trial: boolean
  playable: boolean
  level?: string
  quality?: string
  br?: number
  filename?: string
  requestedQuality?: string
  trialInfo?: unknown
  restriction?: import('@shared/models').PlaybackRestriction
  reason?: string
  message?: string
  diagnostics?: Readonly<Record<string, unknown>>
  error?: string
  trialDuration?: number
  loggedIn?: boolean
  playbackKeyReady?: boolean
}

export interface ProviderLikedTracksResult extends LikedTracksResult {
  error?: 'LOGIN_REQUIRED' | 'LIKED_TRACKS_UNAVAILABLE'
  message?: string
}

/** Shape consumed by src/main before it registers the opaque flux-media handle. */
export interface MainPlaybackResource extends Omit<PlaybackResolveResult, 'url'> {
  upstreamUrl: string | null
  upstreamHeaders?: Readonly<Record<string, string>>
}
