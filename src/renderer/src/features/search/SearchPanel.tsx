import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ProviderId } from '@shared/models'
import { coverProxyUrl, musicErrorMessage } from '../../api'
import { Input } from '../../components/ui/input'
import { useClassicControlGlass } from '../../components/glass/classic-control'
import { usePlayer } from '../../stores/player'
import {
  CLASSIC_GLASS_FILTER_ID,
  CLASSIC_GLASS_FILTER_SVG,
  CLASSIC_GLASS_MAP_ID,
  useThemeStore,
} from '../../theme'
import { createSearchDismissScheduler, isSearchDismissKey } from './interaction'
import { createSearchQuery } from './queries'
import { useDebounced } from './useDebounced'

const PROVIDER_ORDER_KEY = 'fluxplayer-search-provider-order-v1'

function readProviderOrder(): ProviderId[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PROVIDER_ORDER_KEY) || 'null')
    if (Array.isArray(value) && value.length === 2 && value.includes('netease') && value.includes('qq')) {
      return value as ProviderId[]
    }
  } catch {
    // Use the stable default for this session.
  }
  return ['netease', 'qq']
}

interface SearchPanelProps {
  provider: ProviderId
  onProviderChange(provider: ProviderId): void
}

export function SearchPanel({ provider, onProviderChange }: SearchPanelProps): React.JSX.Element {
  const classicTheme = useThemeStore((state) => state.selectedPresetId === 'classic-gold')
  const current = usePlayer((state) => state.current)
  const setQueue = usePlayer((state) => state.setQueue)
  const [keyword, setKeyword] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchVisible, setSearchVisible] = useState(false)
  const [providerOrder, setProviderOrder] = useState<ProviderId[]>(readProviderOrder)
  const [draggedProvider, setDraggedProvider] = useState<ProviderId | null>(null)
  const debouncedKeyword = useDebounced(keyword.trim(), 320)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const sensorRef = useRef<HTMLDivElement>(null)
  const closeScheduler = useMemo(() => createSearchDismissScheduler(), [])
  const previousKeywordEmpty = useRef(true)
  const searchGlassRef = useClassicControlGlass(
    classicTheme,
    'flux-classic-search-glass-filter',
    'flux-classic-search-glass-map',
    'classic-search-glass-svg-ok',
  )

  const neteaseSearch = useQuery({
    ...createSearchQuery('netease', debouncedKeyword, 20),
    enabled: debouncedKeyword.length > 0,
  })
  const qqSearch = useQuery({
    ...createSearchQuery('qq', debouncedKeyword, 12),
    enabled: debouncedKeyword.length > 0,
  })
  const activeSearch = provider === 'qq' ? qqSearch : neteaseSearch
  const songs = useMemo(() => activeSearch.data?.songs ?? [], [activeSearch.data?.songs])

  useEffect(() => {
    const hasKeyword = Boolean(keyword.trim())
    if (hasKeyword && previousKeywordEmpty.current) onProviderChange(providerOrder[0])
    previousKeywordEmpty.current = !hasKeyword
  }, [keyword, onProviderChange, providerOrder])

  useEffect(() => {
    try {
      localStorage.setItem(PROVIDER_ORDER_KEY, JSON.stringify(providerOrder))
    } catch {
      // Keep the order for this session when persistence is unavailable.
    }
  }, [providerOrder])

  const revealSearch = useCallback((): void => {
    closeScheduler.cancel()
    setSearchVisible(true)
    if (keyword.trim()) setSearchOpen(true)
  }, [closeScheduler, keyword])

  const dismissSearch = useCallback((): void => {
    closeScheduler.cancel()
    setSearchOpen(false)
    setSearchVisible(false)
  }, [closeScheduler])

  const scheduleSearchDismiss = useCallback((): void => {
    closeScheduler.schedule(() => {
      if (searchRef.current?.contains(document.activeElement)) return
      setSearchOpen(false)
      setSearchVisible(false)
    })
  }, [closeScheduler])

  useEffect(() => {
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!searchRef.current?.contains(target) && !sensorRef.current?.contains(target)) dismissSearch()
    }
    const escape = (event: KeyboardEvent): void => {
      if (!isSearchDismissKey(event.key)) return
      dismissSearch()
      if (searchRef.current?.contains(document.activeElement)) {
        inputRef.current?.blur()
      }
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', escape, true)
    return () => {
      closeScheduler.dispose()
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', escape, true)
    }
  }, [closeScheduler, dismissSearch])

  const dropProvider = (target: ProviderId): void => {
    if (!draggedProvider || draggedProvider === target) return
    setProviderOrder([target, draggedProvider])
    setDraggedProvider(null)
  }

  return (
    <>
      <div
        ref={sensorRef}
        className="search-hover-sensor"
        aria-hidden="true"
        onPointerEnter={revealSearch}
        onPointerLeave={scheduleSearchDismiss}
      />
      <div
        className={`search-shell${searchVisible ? ' is-visible' : ''}`}
        ref={searchRef}
        onPointerEnter={revealSearch}
        onPointerLeave={scheduleSearchDismiss}
        onFocusCapture={revealSearch}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) scheduleSearchDismiss()
        }}
      >
        <div ref={searchGlassRef} className={`searchbar${classicTheme ? ' classic-search-glass' : ''}`}>
          {classicTheme ? (
            <svg className="control-glass-filter-svg" aria-hidden="true" focusable="false">
              <defs
                dangerouslySetInnerHTML={{
                  __html: CLASSIC_GLASS_FILTER_SVG.replaceAll(
                    CLASSIC_GLASS_FILTER_ID,
                    'flux-classic-search-glass-filter',
                  ).replaceAll(CLASSIC_GLASS_MAP_ID, 'flux-classic-search-glass-map'),
                }}
              />
            </svg>
          ) : null}
          <Input
            ref={inputRef}
            value={keyword}
            placeholder="搜索歌曲 / 歌手"
            onFocus={revealSearch}
            onChange={(event) => {
              const nextKeyword = event.target.value
              setKeyword(nextKeyword)
              setSearchVisible(true)
              setSearchOpen(Boolean(nextKeyword.trim()))
            }}
            aria-expanded={searchOpen && Boolean(keyword.trim())}
            aria-controls="search-results-popover"
          />
        </div>
        {searchOpen && keyword.trim() ? (
          <section id="search-results-popover" className="search-popover glass-surface" aria-label="搜索结果">
            <div className="search-provider-tabs" role="tablist" aria-label="搜索渠道">
              {providerOrder.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  draggable
                  aria-selected={provider === item}
                  className={provider === item ? 'active' : ''}
                  onDragStart={() => setDraggedProvider(item)}
                  onDragEnd={() => setDraggedProvider(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => dropProvider(item)}
                  onClick={() => onProviderChange(item)}
                >
                  {item === 'netease' ? '网易云' : 'QQ 音乐'}
                  <small>
                    {item === 'netease'
                      ? (neteaseSearch.data?.songs.length ?? 0)
                      : (qqSearch.data?.songs.length ?? 0)}
                  </small>
                </button>
              ))}
              <span className="search-parallel-hint">双渠道并行</span>
            </div>
            <div className="results search-results" data-scroll-region>
              {songs.length === 0 ? (
                <div className="empty">
                  {activeSearch.isFetching
                    ? '搜索中…'
                    : activeSearch.error instanceof Error
                      ? `搜索失败：${musicErrorMessage(activeSearch.error, '搜索失败')}`
                      : debouncedKeyword
                        ? '没有结果'
                        : '准备搜索…'}
                </div>
              ) : (
                songs.map((song, index) => {
                  const key = `${song.provider}-${song.id}`
                  const active = current && `${current.provider}-${current.id}` === key
                  return (
                    <button
                      type="button"
                      key={`${key}-${index}`}
                      className={`result-row${active ? ' active' : ''}`}
                      onClick={() => {
                        dismissSearch()
                        setKeyword('')
                        void setQueue([...songs], index)
                      }}
                    >
                      {song.cover ? (
                        <img src={coverProxyUrl(song.cover)} alt="" loading="lazy" />
                      ) : (
                        <span className="result-cover-placeholder" />
                      )}
                      <span className="meta">
                        <strong className="name">{song.name}</strong>
                        <small className="artist">
                          {song.artist}
                          {song.album ? ` · ${song.album}` : ''}
                        </small>
                      </span>
                      <span className="tag">{song.provider === 'qq' ? 'QQ' : '网易云'}</span>
                    </button>
                  )
                })
              )}
            </div>
          </section>
        ) : null}
      </div>
    </>
  )
}
