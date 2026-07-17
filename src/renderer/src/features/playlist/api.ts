import type { ProviderId } from '@shared/models'
import type { PlaylistListResult, PlaylistTracksResult } from '@shared/music-contract'
import { getPlaylists, getPlaylistTracks } from '../../api'

export type { PlaylistListResult, PlaylistTracksResult }

export function fetchPlaylists(
  provider: ProviderId,
  limit = 60,
  signal?: AbortSignal,
): Promise<PlaylistListResult> {
  return getPlaylists({ provider, limit }, signal)
}

export function fetchPlaylistTracks(
  provider: ProviderId,
  id: string | number,
  signal?: AbortSignal,
): Promise<PlaylistTracksResult> {
  return getPlaylistTracks({ provider, id }, signal)
}
