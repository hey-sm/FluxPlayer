/**
 * NeteaseCloudMusicApi 的类型门面。
 * 该包为 CJS、无严格类型，统一收敛为 loose 签名，避免版本间签名漂移导致编译失败。
 */
import * as ncmModule from 'NeteaseCloudMusicApi'

export interface NcmResponse {
  status?: number
  body?: any
  cookie?: string[] | string
  [key: string]: any
}

export type NcmCall = (params?: Record<string, any>) => Promise<NcmResponse>

export interface NcmApi {
  cloudsearch: NcmCall
  song_detail: NcmCall
  song_url: NcmCall
  song_url_v1?: NcmCall
  login_qr_key: NcmCall
  login_qr_create: NcmCall
  login_qr_check: NcmCall
  login_status: NcmCall
  logout: NcmCall
  user_account: NcmCall
  user_playlist: NcmCall
  comment_music: NcmCall
  artist_detail: NcmCall
  artist_top_song: NcmCall
  artist_songs: NcmCall
  like: NcmCall
  likelist: NcmCall
  song_like_check?: NcmCall
  playlist_tracks: NcmCall
  playlist_track_add?: NcmCall
  playlist_create: NcmCall
  playlist_detail?: NcmCall
  playlist_track_all?: NcmCall
  personalized: NcmCall
  recommend_resource: NcmCall
  recommend_songs: NcmCall
  dj_hot: NcmCall
  lyric: NcmCall
  lyric_new?: NcmCall
}

const runtimeModule = ncmModule as unknown as { default?: unknown }
export const ncm = (runtimeModule.default ?? ncmModule) as NcmApi
