import type { QueryClient } from '@tanstack/react-query'
import type { ProviderId } from '@shared/models'

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

/** Call before/after logout or account replacement so data from the old identity cannot flash. */
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
