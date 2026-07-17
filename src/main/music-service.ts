import type { MainMusicService, MainPlaybackResolution } from './ipc'
import type { CredentialStore } from '@server/types'
import { MusicService } from '@server/music'

/** Adapts the provider service to the Electron-only playback source boundary. */
export function createMainMusicService(credentials: CredentialStore): MainMusicService {
  const service = new MusicService(credentials)
  return {
    search: (request) => service.search(request),
    resolvePlayback: (request): Promise<MainPlaybackResolution> => service.resolvePlayback(request),
    getLyrics: (request) => service.getLyrics(request),
    getAuthStatus: (provider) => service.getAuthStatus(provider),
    authenticate: (provider, cookie) => service.acceptLoginCredential(provider, cookie),
    logout: (provider) => service.logout(provider),
    getPlaylists: (request) => service.getPlaylists(request),
    getPlaylistTracks: (request) => service.getPlaylistTracks(request),
    getLikedTracks: (request) => service.getLikedTracks(request),
  }
}
