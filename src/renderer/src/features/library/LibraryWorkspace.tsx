import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PlaylistTracksResult } from '@shared/music-contract'
import type { ProviderId, UnifiedPlaylist, UnifiedSong } from '@shared/models'
import { coverProxyUrl, musicErrorMessage, normalizeCoverSource } from '../../api'
import { AccountArea } from '../account/AccountArea'
import { useAuth } from '../../stores/auth'
import { usePlayer } from '../../stores/player'
import { LibrarySheet } from '../../components/shell/LibrarySheet'
import { PlaylistDetailSheet } from '../../components/shell/PlaylistDetailSheet'
import { AnimatedList } from '../../components/react-bits/AnimatedList'
import {
  clearPlaylistIdentity,
  createPlaylistListQuery,
  createPlaylistTracksQuery,
  lastPlaylistStorageKey,
  prefetchLastPlaylist,
  prefetchPlaylistWindow,
  PLAYLIST_TRACKS_STALE_TIME,
} from '../playlist'
import { fetchLikedTracks } from './api'
import { libraryQueryKeys } from './queries'
import { readRecentPlays, recordRecentPlay, subscribeRecentPlays } from './recent'
import {
  libraryRowVariants,
  libraryShortcutVariants,
  libraryStatusVariants,
  providerTabVariants,
} from './variants'

interface PlaylistDetail {
  readonly provider: ProviderId
  readonly identityToken: string
  readonly playlist: UnifiedPlaylist
  readonly tracks: readonly UnifiedSong[]
  readonly status: 'loading' | 'success' | 'error'
  readonly error?: string
}

const DETAIL_ROW_HEIGHT = 58

function PlaylistCoverImage({
  candidates,
  className,
}: {
  candidates: readonly string[]
  className?: string
}): React.JSX.Element {
  const sources = useMemo(
    () => [
      ...new Set(candidates.map(normalizeCoverSource).filter(Boolean).map(coverProxyUrl).filter(Boolean)),
    ],
    [candidates],
  )
  const [sourceIndex, setSourceIndex] = useState(0)
  useEffect(() => setSourceIndex(0), [sources])
  if (!sources[sourceIndex]) return <span className={className} aria-hidden="true" />
  return (
    <img
      className={className}
      src={sources[sourceIndex]}
      alt=""
      loading="lazy"
      onError={() => setSourceIndex((index) => index + 1)}
    />
  )
}

function PlaylistDetailPanel({
  detail,
  onTrackSelect,
}: {
  detail: PlaylistDetail
  onTrackSelect(): void
}): React.JSX.Element {
  const setQueue = usePlayer((state) => state.setQueue)

  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col p-3.5 text-[var(--flux-text)]"
      aria-label={`${detail.playlist.name}歌曲`}
      data-library-detail-panel=""
    >
      <header className="mb-2.5 grid grid-cols-[48px_minmax(0,1fr)] items-center gap-2.5">
        <PlaylistCoverImage
          key={`${detail.playlist.id}:${detail.playlist.cover}:${detail.tracks[0]?.cover ?? ''}`}
          candidates={[detail.playlist.cover || '', detail.tracks.find((track) => track.cover)?.cover || '']}
          className="size-12 rounded-[var(--flux-radius-control)] bg-[color-mix(in_srgb,var(--flux-panel-border)_7%,transparent)] object-cover"
        />
        <span className="min-w-0">
          <strong className="block truncate">{detail.playlist.name}</strong>
          <small className="mt-[3px] block truncate text-[11px] text-[var(--flux-text-muted)]">
            {detail.playlist.creator ? `${detail.playlist.creator} · ` : ''}
            {detail.playlist.trackCount || detail.tracks.length} 首
          </small>
        </span>
      </header>
      {detail.status === 'loading' ? (
        <div className={libraryStatusVariants()} data-library-detail-status="loading">
          正在加载歌曲…
        </div>
      ) : null}
      {detail.status === 'error' ? (
        <div className={libraryStatusVariants({ tone: 'danger' })} data-library-detail-status="error">
          {detail.error || '歌单加载失败'}
        </div>
      ) : null}
      {detail.status === 'success' && detail.tracks.length === 0 ? (
        <div className={libraryStatusVariants()} data-library-detail-status="empty">
          歌单暂无歌曲
        </div>
      ) : null}
      {detail.tracks.length > 0 ? (
        <AnimatedList
          items={detail.tracks}
          getKey={(song, index) => `${detail.provider}:${song.id}:${index}`}
          ariaLabel={`${detail.playlist.name}歌曲列表`}
          className="min-h-0 flex-1 overflow-hidden"
          itemClassName={libraryRowVariants({ layout: 'detail' })}
          virtualization={{ rowHeight: DETAIL_ROW_HEIGHT, overscan: 3 }}
          getItemAriaLabel={(song) => `播放 ${song.name}，${song.artist || '未知歌手'}`}
          onItemSelect={(_song, index) => {
            onTrackSelect()
            void setQueue([...detail.tracks], index)
          }}
          renderItem={(song) => (
            <>
              {song.cover ? (
                <img
                  className="size-10 rounded-[var(--flux-radius-control)] bg-[color-mix(in_srgb,var(--flux-panel-border)_7%,transparent)] object-cover"
                  src={coverProxyUrl(song.cover)}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <span className="size-10 rounded-[var(--flux-radius-control)] bg-[color-mix(in_srgb,var(--flux-panel-border)_7%,transparent)]" />
              )}
              <span className="min-w-0">
                <strong className="block truncate">{song.name}</strong>
                <small className="mt-[3px] block truncate text-[11px] text-[var(--flux-text-muted)]">
                  {song.artist || '未知歌手'}
                </small>
              </span>
            </>
          )}
        />
      ) : null}
    </aside>
  )
}

interface LibraryWorkspaceProps {
  provider: ProviderId
  onProviderChange(provider: ProviderId): void
}

export function LibraryWorkspace({ provider, onProviderChange }: LibraryWorkspaceProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const neteaseAuth = useAuth((state) => state.netease)
  const qqAuth = useAuth((state) => state.qq)
  const current = usePlayer((state) => state.current)
  const playerStatus = usePlayer((state) => state.status)
  const activeAuth = provider === 'qq' ? qqAuth : neteaseAuth
  const activeIdentity = activeAuth?.loggedIn
    ? `${provider === 'qq' ? 'uin' : 'user'}:${activeAuth.userId ?? ''}`
    : ''
  const loggedIn = activeAuth?.loggedIn === true
  const activeUserId = activeAuth?.userId
  const scope = `${provider}:${activeIdentity}`
  const recentIdentity = useMemo(() => ({ provider, userId: activeUserId }), [activeUserId, provider])
  const [detail, setDetail] = useState<PlaylistDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(true)
  const [recentTracks, setRecentTracks] = useState<UnifiedSong[]>([])
  const [coverFallbacks, setCoverFallbacks] = useState<Record<string, string[]>>({})
  const requestGeneration = useRef(0)
  const currentScope = useRef(scope)
  const previousIdentities = useRef<Record<ProviderId, string>>({ netease: '', qq: '' })

  const playlistsQuery = useQuery({
    ...createPlaylistListQuery(provider, activeIdentity, 120),
    enabled: loggedIn && activeIdentity.length > 0,
    staleTime: 5 * 60 * 1000,
  })
  const playlists = useMemo(() => playlistsQuery.data?.playlists ?? [], [playlistsQuery.data])

  useEffect(() => {
    currentScope.current = scope
    requestGeneration.current += 1
    setDetail(null)
    setDetailOpen(false)
    setCoverFallbacks({})
  }, [scope])

  useEffect(() => {
    if (!activeIdentity || playlists.length === 0) return
    void prefetchLastPlaylist(queryClient, provider, activeIdentity, playlists).catch(() => {
      // A prefetch failure must not affect the library list.
    })

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void prefetchPlaylistWindow(queryClient, provider, activeIdentity, playlists, {
        concurrency: 2,
        signal: controller.signal,
      }).catch(() => {
        // Background warming is best-effort; intent prefetch remains available.
      })
    }, 250)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [activeIdentity, playlists, provider, queryClient, scope])

  useEffect(() => {
    if (!current || (playerStatus !== 'loading' && playerStatus !== 'playing')) return
    setDetailOpen(false)
    setLibraryOpen(false)
  }, [current, playerStatus])

  const prefetchPlaylist = useCallback(
    (playlist: UnifiedPlaylist) => {
      if (!activeIdentity) return
      void queryClient.prefetchQuery({
        ...createPlaylistTracksQuery(provider, activeIdentity, playlist.id),
        staleTime: PLAYLIST_TRACKS_STALE_TIME,
      })
    },
    [activeIdentity, provider, queryClient],
  )

  useEffect(() => {
    const currentIdentities: Record<ProviderId, string> = {
      netease: neteaseAuth?.loggedIn && neteaseAuth.userId != null ? `user:${neteaseAuth.userId}` : '',
      qq: qqAuth?.loggedIn && qqAuth.userId != null ? `uin:${qqAuth.userId}` : '',
    }
    for (const candidate of ['netease', 'qq'] as const) {
      const previous = previousIdentities.current[candidate]
      if (previous && previous !== currentIdentities[candidate]) {
        void clearPlaylistIdentity(queryClient, candidate, previous)
      }
    }
    previousIdentities.current = currentIdentities
  }, [neteaseAuth, qqAuth, queryClient])

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) setRecentTracks(readRecentPlays(recentIdentity).map((entry) => entry.track))
    })
    const unsubscribe = subscribeRecentPlays(recentIdentity, (entries) =>
      setRecentTracks(entries.map((entry) => entry.track)),
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [recentIdentity])

  useEffect(() => {
    if (!current || playerStatus !== 'playing') return
    const userId = current.provider === 'qq' ? qqAuth?.userId : neteaseAuth?.userId
    recordRecentPlay({ provider: current.provider, userId }, current)
  }, [current, neteaseAuth?.userId, playerStatus, qqAuth?.userId])

  const openTracks = useCallback(
    (title: string, tracks: UnifiedSong[], tag: string) => {
      const playlist: UnifiedPlaylist = {
        provider,
        type: 'playlist',
        id: `flux:${tag}`,
        name: title,
        cover: tracks[0]?.cover || '',
        trackCount: tracks.length,
        tag,
      }
      setDetail({
        provider,
        identityToken: activeIdentity || 'guest',
        playlist,
        tracks,
        status: 'success',
      })
      setDetailOpen(true)
    },
    [activeIdentity, provider],
  )

  const openPlaylist = useCallback(
    (playlist: UnifiedPlaylist) => {
      if (!activeIdentity) return
      localStorage.setItem(lastPlaylistStorageKey(provider, activeIdentity), String(playlist.id))
      const generation = ++requestGeneration.current
      const query = createPlaylistTracksQuery(provider, activeIdentity, playlist.id)
      const cached = queryClient.getQueryData<PlaylistTracksResult>(query.queryKey)
      setDetail({
        provider,
        identityToken: activeIdentity,
        playlist: cached?.playlist ?? playlist,
        tracks: cached?.tracks ?? [],
        status: cached ? 'success' : 'loading',
      })
      setDetailOpen(true)

      void queryClient
        .fetchQuery({
          ...query,
          staleTime: PLAYLIST_TRACKS_STALE_TIME,
        })
        .then((result) => {
          if (generation !== requestGeneration.current || currentScope.current !== scope) return
          const resolvedPlaylist = result.playlist ?? playlist
          const firstCover = result.tracks.find((track) => track.cover)?.cover || ''
          setCoverFallbacks((currentFallbacks) => ({
            ...currentFallbacks,
            [String(playlist.id)]: [resolvedPlaylist.cover, firstCover].filter(Boolean),
          }))
          setDetail({
            provider,
            identityToken: activeIdentity,
            playlist: resolvedPlaylist,
            tracks: result.tracks,
            status: 'success',
          })
        })
        .catch((error: unknown) => {
          if (generation !== requestGeneration.current || currentScope.current !== scope) return
          if (cached) return
          setDetail({
            provider,
            identityToken: activeIdentity,
            playlist,
            tracks: [],
            status: 'error',
            error: musicErrorMessage(error, '歌单加载失败'),
          })
        })
    },
    [activeIdentity, provider, queryClient, scope],
  )

  const openLikedTracks = useCallback(() => {
    if (!loggedIn || !activeIdentity) return
    const generation = ++requestGeneration.current
    const playlist: UnifiedPlaylist = {
      provider,
      type: 'playlist',
      id: 'flux:liked',
      name: '我的喜欢',
      cover: '',
      trackCount: 0,
    }
    setDetail({ provider, identityToken: activeIdentity, playlist, tracks: [], status: 'loading' })
    setDetailOpen(true)
    void queryClient
      .fetchQuery({
        queryKey: libraryQueryKeys.liked(provider, activeIdentity, { limit: 200 }),
        queryFn: ({ signal }) => fetchLikedTracks(provider, { limit: 200 }, signal),
        staleTime: 60 * 1000,
      })
      .then((result) => {
        if (generation === requestGeneration.current && currentScope.current === scope) {
          openTracks('我的喜欢', result.tracks, '平台收藏')
        }
      })
      .catch((error: unknown) => {
        if (generation !== requestGeneration.current || currentScope.current !== scope) return
        setDetail({
          provider,
          identityToken: activeIdentity,
          playlist,
          tracks: [],
          status: 'error',
          error: musicErrorMessage(error, '喜欢歌曲加载失败'),
        })
      })
  }, [activeIdentity, loggedIn, openTracks, provider, queryClient, scope])

  const visibleDetail =
    detail && detail.provider === provider && detail.identityToken === (activeIdentity || 'guest')
      ? detail
      : null

  const closeListsForPlayback = useCallback(() => {
    setDetailOpen(false)
    setLibraryOpen(false)
  }, [])

  return (
    <>
      <PlaylistDetailSheet open={detailOpen} available={Boolean(visibleDetail)} onOpenChange={setDetailOpen}>
        {visibleDetail ? (
          <PlaylistDetailPanel
            key={`${visibleDetail.provider}:${visibleDetail.playlist.id}`}
            detail={visibleDetail}
            onTrackSelect={closeListsForPlayback}
          />
        ) : (
          <div className={libraryStatusVariants()} data-library-detail-status="unavailable">
            请先从音乐库选择歌单
          </div>
        )}
      </PlaylistDetailSheet>
      <LibrarySheet open={libraryOpen} onOpenChange={setLibraryOpen}>
        <aside
          className="flex h-full min-h-0 w-full flex-col p-3.5 text-[var(--flux-text)]"
          aria-label="用户音乐库"
          data-library-panel=""
        >
          <div className="mb-3 flex items-center gap-1.5" role="tablist" aria-label="音乐平台">
            {(['netease', 'qq'] as const).map((item) => (
              <button
                key={item}
                role="tab"
                aria-selected={provider === item}
                className={providerTabVariants({ active: provider === item })}
                data-library-provider={item}
                onClick={() => onProviderChange(item)}
              >
                {item === 'netease' ? '网易云' : 'QQ 音乐'}
              </button>
            ))}
          </div>
          <AccountArea
            provider={provider}
            className="mr-0 mb-3 min-h-[34px] [&_[data-account-nickname]]:max-w-[135px]"
          />
          <div className="mb-3 grid grid-cols-2 gap-2" aria-label="快捷歌单" data-library-shortcuts="">
            <button
              className={libraryShortcutVariants()}
              type="button"
              disabled={!loggedIn}
              onClick={openLikedTracks}
            >
              <strong className="block">我的喜欢</strong>
              <small className="mt-1 block text-[10px] text-[var(--flux-text-muted)]">
                {loggedIn ? '平台收藏' : '登录后查看'}
              </small>
            </button>
            <button
              className={libraryShortcutVariants()}
              type="button"
              disabled={recentTracks.length === 0}
              onClick={() => openTracks('最近播放', recentTracks, 'FluxPlayer 记录')}
            >
              <strong className="block">最近播放</strong>
              <small className="mt-1 block text-[10px] text-[var(--flux-text-muted)]">
                {recentTracks.length ? `${recentTracks.length} 首` : '暂无记录'}
              </small>
            </button>
          </div>
          {playlistsQuery.isFetching ? (
            <div className="px-2.5 py-1.5 text-[11px] text-[var(--flux-text-muted)]" data-library-sync="">
              正在同步歌单…
            </div>
          ) : null}
          <AnimatedList
            items={playlists}
            getKey={(playlist) => String(playlist.id)}
            selectedKey={visibleDetail ? String(visibleDetail.playlist.id) : null}
            ariaLabel="歌单列表"
            className="min-h-0 flex-1 overflow-hidden"
            itemClassName={libraryRowVariants({ layout: 'playlist' })}
            getItemAriaLabel={(playlist) => `${playlist.name}，${playlist.trackCount} 首`}
            onItemIntent={prefetchPlaylist}
            onItemSelect={openPlaylist}
            renderItem={(playlist) => (
              <>
                <PlaylistCoverImage
                  key={`${playlist.id}:${playlist.cover}:${(coverFallbacks[String(playlist.id)] ?? []).join('|')}`}
                  candidates={[playlist.cover || '', ...(coverFallbacks[String(playlist.id)] ?? [])]}
                  className="size-[42px] rounded-[var(--flux-radius-control)] bg-[var(--flux-accent-soft)] object-cover"
                />
                <span className="min-w-0">
                  <strong className="block truncate">{playlist.name}</strong>
                  <small className="mt-[3px] block truncate text-[11px] text-[var(--flux-text-muted)]">
                    {playlist.trackCount} 首
                  </small>
                </span>
              </>
            )}
          />
        </aside>
      </LibrarySheet>
    </>
  )
}
