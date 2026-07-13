import type { ProviderId, UnifiedSong } from '@shared/models'

export const RECENT_PLAYBACK_LIMIT = 200
export const RECENT_PLAYBACK_STORAGE_PREFIX = 'fluxplayer.library.recent.v1'

export interface RecentPlaybackIdentity {
  provider: ProviderId
  userId?: string | number | null
}

export interface RecentPlaybackEntry {
  track: UnifiedSong
  playedAt: number
}

export interface RecentPlaybackStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type RecentPlaybackListener = (entries: RecentPlaybackEntry[]) => void

type PersistedRecentPlayback = {
  version: 1
  entries: RecentPlaybackEntry[]
}

function identityToken(identity: RecentPlaybackIdentity): string {
  const raw = identity.userId == null ? '' : String(identity.userId).trim()
  return raw ? `user:${raw}` : 'guest'
}

export function recentPlaybackStorageKey(identity: RecentPlaybackIdentity): string {
  return `${RECENT_PLAYBACK_STORAGE_PREFIX}:${identity.provider}:${encodeURIComponent(identityToken(identity))}`
}

export function recentTrackKey(track: Pick<UnifiedSong, 'provider' | 'id'>): string {
  return `${track.provider}:${String(track.id)}`
}

function browserStorage(): RecentPlaybackStorage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined
  } catch {
    return undefined
  }
}

function cloneTrack(track: UnifiedSong): UnifiedSong {
  return { ...track, artists: track.artists.map((artist) => ({ ...artist })) }
}

function cloneEntries(entries: readonly RecentPlaybackEntry[]): RecentPlaybackEntry[] {
  return entries.map((entry) => ({ track: cloneTrack(entry.track), playedAt: entry.playedAt }))
}

function isPersistedEntry(value: unknown): value is RecentPlaybackEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<RecentPlaybackEntry>
  const track = entry.track as Partial<UnifiedSong> | undefined
  return (
    Number.isFinite(entry.playedAt) &&
    !!track &&
    (track.provider === 'netease' || track.provider === 'qq') &&
    track.id !== undefined &&
    track.id !== null &&
    String(track.id) !== '' &&
    typeof track.name === 'string' &&
    Array.isArray(track.artists)
  )
}

function parseEntries(raw: string | null, limit: number): RecentPlaybackEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedRecentPlayback>
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return []
    const seen = new Set<string>()
    const entries: RecentPlaybackEntry[] = []
    for (const entry of parsed.entries) {
      if (!isPersistedEntry(entry)) continue
      const key = recentTrackKey(entry.track)
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({ track: cloneTrack(entry.track), playedAt: entry.playedAt })
      if (entries.length >= limit) break
    }
    return entries
  } catch {
    return []
  }
}

export class RecentPlaybackStore {
  private readonly cache = new Map<string, RecentPlaybackEntry[]>()
  private readonly listeners = new Map<string, Set<RecentPlaybackListener>>()

  constructor(
    private readonly storage?: RecentPlaybackStorage,
    private readonly limit = RECENT_PLAYBACK_LIMIT,
  ) {}

  read(identity: RecentPlaybackIdentity): RecentPlaybackEntry[] {
    const key = recentPlaybackStorageKey(identity)
    let entries = this.cache.get(key)
    if (!entries) {
      const storage = this.storage ?? browserStorage()
      let raw: string | null = null
      try {
        raw = storage?.getItem(key) ?? null
      } catch {
        raw = null
      }
      entries = parseEntries(raw, this.safeLimit())
      this.cache.set(key, entries)
    }
    return cloneEntries(entries)
  }

  record(
    identity: RecentPlaybackIdentity,
    track: UnifiedSong,
    playedAt = Date.now(),
  ): RecentPlaybackEntry[] {
    if (track.provider !== identity.provider) {
      throw new Error('RECENT_TRACK_PROVIDER_MISMATCH')
    }
    const key = recentPlaybackStorageKey(identity)
    const timestamp = Number.isFinite(playedAt) ? playedAt : Date.now()
    const trackKey = recentTrackKey(track)
    const entries = [
      { track: cloneTrack(track), playedAt: timestamp },
      ...this.read(identity).filter((entry) => recentTrackKey(entry.track) !== trackKey),
    ].slice(0, this.safeLimit())
    this.cache.set(key, entries)
    try {
      const storage = this.storage ?? browserStorage()
      storage?.setItem(key, JSON.stringify({ version: 1, entries } satisfies PersistedRecentPlayback))
    } catch {
      // Runtime state and subscriptions remain usable when localStorage is unavailable or full.
    }
    this.emit(key, entries)
    return cloneEntries(entries)
  }

  subscribe(identity: RecentPlaybackIdentity, listener: RecentPlaybackListener): () => void {
    const key = recentPlaybackStorageKey(identity)
    let scoped = this.listeners.get(key)
    if (!scoped) {
      scoped = new Set()
      this.listeners.set(key, scoped)
    }
    scoped.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      scoped?.delete(listener)
      if (scoped?.size === 0) this.listeners.delete(key)
    }
  }

  private safeLimit(): number {
    return Math.max(1, Math.min(RECENT_PLAYBACK_LIMIT, Math.floor(this.limit || RECENT_PLAYBACK_LIMIT)))
  }

  private emit(key: string, entries: readonly RecentPlaybackEntry[]): void {
    this.listeners.get(key)?.forEach((listener) => listener(cloneEntries(entries)))
  }
}

const recentPlaybackStore = new RecentPlaybackStore()

export function readRecentPlays(identity: RecentPlaybackIdentity): RecentPlaybackEntry[] {
  return recentPlaybackStore.read(identity)
}

export function recordRecentPlay(
  identity: RecentPlaybackIdentity,
  track: UnifiedSong,
  playedAt?: number,
): RecentPlaybackEntry[] {
  return recentPlaybackStore.record(identity, track, playedAt)
}

export function subscribeRecentPlays(
  identity: RecentPlaybackIdentity,
  listener: RecentPlaybackListener,
): () => void {
  return recentPlaybackStore.subscribe(identity, listener)
}
