import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { parseCookieString } from '../../util/cookies'
import { asRecord } from '../../util/unknown'

export interface NcmResponse {
  status?: number
  body?: unknown
  cookie?: string[] | string
  [key: string]: unknown
}

export type NcmParams = Record<string, unknown>
export type NcmCall = (params?: NcmParams) => Promise<NcmResponse>
type NcmRequest = (...args: unknown[]) => Promise<unknown>
type NcmEndpoint = (query: NcmParams, request: NcmRequest) => Promise<unknown> | unknown

type CommonJsModule<T> = { default?: T } & Partial<T>

function unwrapCommonJs<T>(module: CommonJsModule<T>): T {
  return (module.default ?? module) as T
}

function ensureAnonymousTokenFile(): void {
  const tokenPath = resolve(tmpdir(), 'anonymous_token')
  if (!existsSync(tokenPath)) writeFileSync(tokenPath, '', 'utf8')
}

async function loadRequest(): Promise<NcmRequest> {
  ensureAnonymousTokenFile()
  // Deep, literal import is intentional: it lets the main bundle include only the SDK request/encryption runtime.
  // @ts-expect-error NeteaseCloudMusicApi does not publish declarations for deep CommonJS modules.
  const module = await import('NeteaseCloudMusicApi/util/request.js')
  return unwrapCommonJs<NcmRequest>(module)
}

const endpointLoaders = {
  login_status: async (): Promise<NcmEndpoint> => {
    // @ts-expect-error SDK deep modules have no declarations.
    return unwrapCommonJs<NcmEndpoint>(await import('NeteaseCloudMusicApi/module/login_status.js'))
  },
  user_account: async (): Promise<NcmEndpoint> => {
    // @ts-expect-error SDK deep modules have no declarations.
    return unwrapCommonJs<NcmEndpoint>(await import('NeteaseCloudMusicApi/module/user_account.js'))
  },
  cloudsearch: async (): Promise<NcmEndpoint> => {
    // @ts-expect-error SDK deep modules have no declarations.
    return unwrapCommonJs<NcmEndpoint>(await import('NeteaseCloudMusicApi/module/cloudsearch.js'))
  },
  song_detail: async (): Promise<NcmEndpoint> => {
    // @ts-expect-error SDK deep modules have no declarations.
    return unwrapCommonJs<NcmEndpoint>(await import('NeteaseCloudMusicApi/module/song_detail.js'))
  },
  song_url_v1: async (): Promise<NcmEndpoint> => {
    // @ts-expect-error SDK deep modules have no declarations.
    return unwrapCommonJs<NcmEndpoint>(await import('NeteaseCloudMusicApi/module/song_url_v1.js'))
  },
  song_url: async (): Promise<NcmEndpoint> => {
    // @ts-expect-error SDK deep modules have no declarations.
    return unwrapCommonJs<NcmEndpoint>(await import('NeteaseCloudMusicApi/module/song_url.js'))
  },
  lyric_new: async (): Promise<NcmEndpoint> => {
    // @ts-expect-error SDK deep modules have no declarations.
    return unwrapCommonJs<NcmEndpoint>(await import('NeteaseCloudMusicApi/module/lyric_new.js'))
  },
  lyric: async (): Promise<NcmEndpoint> => {
    // @ts-expect-error SDK deep modules have no declarations.
    return unwrapCommonJs<NcmEndpoint>(await import('NeteaseCloudMusicApi/module/lyric.js'))
  },
  user_playlist: async (): Promise<NcmEndpoint> => {
    // @ts-expect-error SDK deep modules have no declarations.
    return unwrapCommonJs<NcmEndpoint>(await import('NeteaseCloudMusicApi/module/user_playlist.js'))
  },
  likelist: async (): Promise<NcmEndpoint> => {
    // @ts-expect-error SDK deep modules have no declarations.
    return unwrapCommonJs<NcmEndpoint>(await import('NeteaseCloudMusicApi/module/likelist.js'))
  },
  playlist_track_all: async (): Promise<NcmEndpoint> => {
    // @ts-expect-error SDK deep modules have no declarations.
    return unwrapCommonJs<NcmEndpoint>(await import('NeteaseCloudMusicApi/module/playlist_track_all.js'))
  },
  playlist_detail: async (): Promise<NcmEndpoint> => {
    // @ts-expect-error SDK deep modules have no declarations.
    return unwrapCommonJs<NcmEndpoint>(await import('NeteaseCloudMusicApi/module/playlist_detail.js'))
  },
  logout: async (): Promise<NcmEndpoint> => {
    // @ts-expect-error SDK deep modules have no declarations.
    return unwrapCommonJs<NcmEndpoint>(await import('NeteaseCloudMusicApi/module/logout.js'))
  },
} as const

export type NcmEndpointName = keyof typeof endpointLoaders
export const NCM_ENDPOINT_ALLOWLIST = Object.freeze(Object.keys(endpointLoaders) as NcmEndpointName[])

const endpointCache = new Map<NcmEndpointName, Promise<NcmEndpoint>>()
let requestPromise: Promise<NcmRequest> | undefined

function endpoint(name: NcmEndpointName): Promise<NcmEndpoint> {
  const cached = endpointCache.get(name)
  if (cached) return cached
  const loaded = endpointLoaders[name]()
  endpointCache.set(name, loaded)
  return loaded
}

async function invoke(name: NcmEndpointName, input: NcmParams = {}): Promise<NcmResponse> {
  const params: NcmParams = { ...input }
  if (typeof params.cookie === 'string') params.cookie = parseCookieString(params.cookie)

  requestPromise ??= loadRequest()
  const [handler, request] = await Promise.all([endpoint(name), requestPromise])
  const raw = await handler(params, request)
  return asRecord(raw) as NcmResponse
}

export interface NcmApi {
  login_status: NcmCall
  user_account: NcmCall
  cloudsearch: NcmCall
  song_detail: NcmCall
  song_url_v1: NcmCall
  song_url: NcmCall
  lyric_new: NcmCall
  lyric: NcmCall
  user_playlist: NcmCall
  likelist: NcmCall
  playlist_track_all: NcmCall
  playlist_detail: NcmCall
  logout: NcmCall
}

/** Fixed endpoint facade. It never imports the package root and never scans the SDK module directory. */
export const ncm: NcmApi = {
  login_status: (params) => invoke('login_status', params),
  user_account: (params) => invoke('user_account', params),
  cloudsearch: (params) => invoke('cloudsearch', params),
  song_detail: (params) => invoke('song_detail', params),
  song_url_v1: (params) => invoke('song_url_v1', params),
  song_url: (params) => invoke('song_url', params),
  lyric_new: (params) => invoke('lyric_new', params),
  lyric: (params) => invoke('lyric', params),
  user_playlist: (params) => invoke('user_playlist', params),
  likelist: (params) => invoke('likelist', params),
  playlist_track_all: (params) => invoke('playlist_track_all', params),
  playlist_detail: (params) => invoke('playlist_detail', params),
  logout: (params) => invoke('logout', params),
}
