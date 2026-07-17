import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProviderId, UnifiedPlaylist, UnifiedSong } from '@shared/models'
import { coverProxyUrl, musicErrorMessage, normalizeCoverSource } from '../../api'
import { AccountArea } from '../account/AccountArea'
import { useAuth } from '../../stores/auth'
import { usePlayer } from '../../stores/player'
import { LibrarySheet } from '../../components/shell/LibrarySheet'
import { PlaylistDetailSheet } from '../../components/shell/PlaylistDetailSheet'
import {
  calculateWindow,
  clearPlaylistIdentity,
  createPlaylistListQuery,
  createPlaylistTracksQuery,
  lastPlaylistStorageKey,
  prefetchLastPlaylist,
} from '../playlist'
import { fetchLikedTracks } from './api'
import { libraryQueryKeys } from './queries'
import { readRecentPlays, recordRecentPlay, subscribeRecentPlays } from './recent'

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

function PlaylistDetailPanel({ detail }: { detail: PlaylistDetail }): React.JSX.Element {
  const setQueue = usePlayer((state) => state.setQueue)
  const [scrollTop, setScrollTop] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [viewportHeight, setViewportHeight] = useState(() => Math.max(220, window.innerHeight - 150))

  useEffect(() => {
    if (detail.tracks.length === 0) return
    const list = listRef.current
    if (!list) return
    const syncViewportHeight = (): void => setViewportHeight(Math.max(1, list.clientHeight))
    syncViewportHeight()
    const resizeObserver = new ResizeObserver(syncViewportHeight)
    resizeObserver.observe(list)
    return () => resizeObserver.disconnect()
  }, [detail.tracks.length])

  const windowSlice = useMemo(
    () => calculateWindow(detail.tracks.length, scrollTop, viewportHeight, DETAIL_ROW_HEIGHT, 3),
    [detail.tracks.length, scrollTop, viewportHeight],
  )
  const visibleTracks = detail.tracks.slice(windowSlice.start, windowSlice.end)

  return (
    <aside className="shelf-detail-panel glass-surface" aria-label={`${detail.playlist.name}歌曲`}>
      <header>
        <PlaylistCoverImage
          key={`${detail.playlist.id}:${detail.playlist.cover}:${detail.tracks[0]?.cover ?? ''}`}
          candidates={[detail.playlist.cover || '', detail.tracks.find((track) => track.cover)?.cover || '']}
        />
        <span>
          <strong>{detail.playlist.name}</strong>
          <small>
            {detail.playlist.creator ? `${detail.playlist.creator} · ` : ''}
            {detail.playlist.trackCount || detail.tracks.length} 首
          </small>
        </span>
      </header>
      {detail.status === 'loading' ? <div className="shelf-detail-status">正在加载歌曲…</div> : null}
      {detail.status === 'error' ? (
        <div className="shelf-detail-status error">{detail.error || '歌单加载失败'}</div>
      ) : null}
      {detail.status === 'success' && detail.tracks.length === 0 ? (
        <div className="shelf-detail-status">歌单暂无歌曲</div>
      ) : null}
      {detail.tracks.length > 0 ? (
        <div
          ref={listRef}
          className="shelf-detail-list"
          data-scroll-region
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div aria-hidden="true" style={{ height: windowSlice.offsetTop }} />
          {visibleTracks.map((song, relativeIndex) => {
            const index = windowSlice.start + relativeIndex
            return (
              <button
                key={`${detail.provider}:${song.id}:${index}`}
                type="button"
                className="shelf-detail-row"
                style={{ height: DETAIL_ROW_HEIGHT }}
                onClick={() => void setQueue([...detail.tracks], index)}
              >
                {song.cover ? <img src={coverProxyUrl(song.cover)} alt="" loading="lazy" /> : <span />}
                <span>
                  <strong>{song.name}</strong>
                  <small>{song.artist || '未知歌手'}</small>
                </span>
              </button>
            )
          })}
          <div aria-hidden="true" style={{ height: windowSlice.offsetBottom }} />
        </div>
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
  const [recentTracks, setRecentTracks] = useState<UnifiedSong[]>([])
  const [coverFallbacks, setCoverFallbacks] = useState<Record<string, string[]>>({})
  const requestGeneration = useRef(0)
  const currentScope = useRef(scope)
  const previousIdentities = useRef<Record<ProviderId, string>>({ netease: '', qq: '' })
  const prefetchedScopes = useRef(new Set<string>())

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
    if (!activeIdentity || playlists.length === 0 || prefetchedScopes.current.has(scope)) return
    prefetchedScopes.current.add(scope)
    void prefetchLastPlaylist(queryClient, provider, activeIdentity, playlists).catch(() => {
      // A prefetch failure must not affect the library list.
    })
  }, [activeIdentity, playlists, provider, queryClient, scope])

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
      setDetail({
        provider,
        identityToken: activeIdentity,
        playlist,
        tracks: [],
        status: 'loading',
      })
      setDetailOpen(true)

      void queryClient
        .fetchQuery({
          ...createPlaylistTracksQuery(provider, activeIdentity, playlist.id),
          staleTime: 5 * 60 * 1000,
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

  return (
    <>
      <PlaylistDetailSheet open={detailOpen} available={Boolean(visibleDetail)} onOpenChange={setDetailOpen}>
        {visibleDetail ? (
          <PlaylistDetailPanel
            key={`${visibleDetail.provider}:${visibleDetail.playlist.id}`}
            detail={visibleDetail}
          />
        ) : (
          <div className="shelf-detail-status">请先从音乐库选择歌单</div>
        )}
      </PlaylistDetailSheet>
      <LibrarySheet>
        <aside className="library-drawer" aria-label="用户音乐库">
          <div className="library-provider-tabs" role="tablist" aria-label="音乐平台">
            {(['netease', 'qq'] as const).map((item) => (
              <button
                key={item}
                role="tab"
                aria-selected={provider === item}
                className={provider === item ? 'active' : ''}
                onClick={() => onProviderChange(item)}
              >
                {item === 'netease' ? '网易云' : 'QQ 音乐'}
              </button>
            ))}
          </div>
          <AccountArea provider={provider} />
          <div className="library-shortcuts" aria-label="快捷歌单">
            <button type="button" disabled={!loggedIn} onClick={openLikedTracks}>
              <strong>我的喜欢</strong>
              <small>{loggedIn ? '平台收藏' : '登录后查看'}</small>
            </button>
            <button
              type="button"
              disabled={recentTracks.length === 0}
              onClick={() => openTracks('最近播放', recentTracks, 'FluxPlayer 记录')}
            >
              <strong>最近播放</strong>
              <small>{recentTracks.length ? `${recentTracks.length} 首` : '暂无记录'}</small>
            </button>
          </div>
          {playlistsQuery.isFetching ? <div className="library-shelf-sync">正在同步歌单…</div> : null}
          <div className="library-playlist-list" data-scroll-region>
            {playlists.map((playlist) => (
              <button
                key={String(playlist.id)}
                type="button"
                className={String(visibleDetail?.playlist.id) === String(playlist.id) ? 'active' : ''}
                onClick={() => openPlaylist(playlist)}
              >
                <PlaylistCoverImage
                  key={`${playlist.id}:${playlist.cover}:${(coverFallbacks[String(playlist.id)] ?? []).join('|')}`}
                  candidates={[playlist.cover || '', ...(coverFallbacks[String(playlist.id)] ?? [])]}
                />
                <span>
                  <strong>{playlist.name}</strong>
                  <small>{playlist.trackCount} 首</small>
                </span>
              </button>
            ))}
          </div>
        </aside>
      </LibrarySheet>
    </>
  )
}
