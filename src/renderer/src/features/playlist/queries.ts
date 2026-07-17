import type { QueryClient, QueryFunctionContext } from '@tanstack/react-query'
import type { ProviderId, UnifiedPlaylist } from '@shared/models'
import { fetchPlaylistTracks, fetchPlaylists } from './api'

export const playlistQueryKeys = {
  all: ['playlist'] as const,
  identity: (provider: ProviderId, identityToken: string) => ['playlist', provider, identityToken] as const,
  lists: (provider: ProviderId, identityToken: string) =>
    ['playlist', provider, identityToken, 'lists'] as const,
  list: (provider: ProviderId, identityToken: string, limit: number) =>
    ['playlist', provider, identityToken, 'lists', limit] as const,
  tracks: (provider: ProviderId, identityToken: string, playlistId: string | number) =>
    ['playlist', provider, identityToken, 'tracks', String(playlistId)] as const,
}

export function createPlaylistListQuery(
  provider: ProviderId,
  identityToken: string,
  limit: number,
): {
  queryKey: ReturnType<typeof playlistQueryKeys.list>
  queryFn(
    context: QueryFunctionContext<ReturnType<typeof playlistQueryKeys.list>>,
  ): ReturnType<typeof fetchPlaylists>
} {
  return {
    queryKey: playlistQueryKeys.list(provider, identityToken, limit),
    queryFn: ({ signal }) => fetchPlaylists(provider, limit, signal),
  }
}

export function createPlaylistTracksQuery(
  provider: ProviderId,
  identityToken: string,
  playlistId: string | number,
): {
  queryKey: ReturnType<typeof playlistQueryKeys.tracks>
  queryFn(
    context: QueryFunctionContext<ReturnType<typeof playlistQueryKeys.tracks>>,
  ): ReturnType<typeof fetchPlaylistTracks>
} {
  return {
    queryKey: playlistQueryKeys.tracks(provider, identityToken, playlistId),
    queryFn: ({ signal }) => fetchPlaylistTracks(provider, playlistId, signal),
  }
}

export const lastPlaylistStorageKey = (provider: ProviderId, identityToken: string): string =>
  `flux-last-playlist:${provider}:${identityToken}`

/** Prefetches at most the single playlist the user last opened; never warms an account in bulk. */
export async function prefetchLastPlaylist(
  queryClient: QueryClient,
  provider: ProviderId,
  identityToken: string,
  playlists: readonly UnifiedPlaylist[],
  storage: Pick<Storage, 'getItem'> = localStorage,
): Promise<void> {
  const savedId = storage.getItem(lastPlaylistStorageKey(provider, identityToken))
  if (!savedId) return
  const playlist = playlists.find((item) => String(item.id) === savedId)
  if (!playlist) return
  await queryClient.prefetchQuery({
    ...createPlaylistTracksQuery(provider, identityToken, playlist.id),
    staleTime: 5 * 60 * 1000,
  })
}

export async function clearPlaylistIdentity(
  queryClient: QueryClient,
  provider: ProviderId,
  identityToken: string,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: playlistQueryKeys.identity(provider, identityToken) })
  queryClient.removeQueries({ queryKey: playlistQueryKeys.identity(provider, identityToken) })
}

export async function invalidatePlaylistIdentity(
  queryClient: QueryClient,
  provider: ProviderId,
  identityToken: string,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: playlistQueryKeys.identity(provider, identityToken) })
}
