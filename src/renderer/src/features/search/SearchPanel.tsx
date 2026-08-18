import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { ProviderId } from '@shared/models'
import { coverProxyUrl, musicErrorMessage } from '../../api'
import { GlassSurface } from '../../components/glass'
import { SnapshotAnimatedContent } from '../../components/react-bits/SnapshotAnimatedContent'
import { Input } from '../../components/ui/input'
import { cn } from '../../lib/utils'
import { Flip, gsap, motionDurations, motionEases, useGSAP, useReducedMotion } from '../../motion'
import { usePlayer } from '../../stores/player'
import { createSearchDismissScheduler, isSearchDismissKey } from './interaction'
import { createSearchQuery } from './queries'
import { useDebounced } from './useDebounced'

const PROVIDER_ORDER_KEY = 'fluxplayer-search-provider-order-v1'
/** 两个 provider 用同一页大小，避免两个 tab 结果数看起来不一致 */
const SEARCH_PAGE_SIZE = 20
/** 距底部多少像素触发下一页 */
const SEARCH_LOAD_MORE_THRESHOLD = 160

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
  const popoverRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const providerTabsRef = useRef<HTMLDivElement>(null)
  const providerFlipStateRef = useRef<ReturnType<typeof Flip.getState> | null>(null)
  const closeScheduler = useMemo(() => createSearchDismissScheduler(), [])
  const previousKeywordEmpty = useRef(true)
  const reducedMotion = useReducedMotion()

  const neteaseSearch = useInfiniteQuery({
    ...createSearchQuery('netease', debouncedKeyword, SEARCH_PAGE_SIZE),
    enabled: debouncedKeyword.length > 0,
  })
  const qqSearch = useInfiniteQuery({
    ...createSearchQuery('qq', debouncedKeyword, SEARCH_PAGE_SIZE),
    enabled: debouncedKeyword.length > 0,
  })
  const activeSearch = provider === 'qq' ? qqSearch : neteaseSearch
  const songs = useMemo(
    () => activeSearch.data?.pages.flatMap((page) => page.songs) ?? [],
    [activeSearch.data?.pages],
  )
  const neteaseCount = useMemo(
    () => neteaseSearch.data?.pages.reduce((total, page) => total + page.songs.length, 0) ?? 0,
    [neteaseSearch.data?.pages],
  )
  const qqCount = useMemo(
    () => qqSearch.data?.pages.reduce((total, page) => total + page.songs.length, 0) ?? 0,
    [qqSearch.data?.pages],
  )

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = activeSearch
  const handleResultsScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!hasNextPage || isFetchingNextPage) return
      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
      if (scrollHeight - scrollTop - clientHeight <= SEARCH_LOAD_MORE_THRESHOLD) void fetchNextPage()
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage],
  )
  const resultAnimationKey = songs.map((song) => `${song.provider}:${song.id}`).join('|')
  const providerOrderKey = providerOrder.join('|')

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

  useGSAP(
    () => {
      const popover = popoverRef.current
      if (!searchOpen || !popover) return
      gsap.killTweensOf(popover)
      if (reducedMotion) {
        gsap.set(popover, { autoAlpha: 1 })
        return
      }
      gsap.fromTo(
        popover,
        { autoAlpha: 0 },
        {
          autoAlpha: 1,
          duration: motionDurations.emphasized,
          ease: motionEases.enter,
          overwrite: 'auto',
        },
      )
      return () => gsap.killTweensOf(popover)
    },
    {
      scope: searchRef,
      dependencies: [reducedMotion, searchOpen],
      revertOnUpdate: true,
    },
  )

  useGSAP(
    () => {
      if (!searchOpen || !resultsRef.current) return
      // 只动画"还没入过场"的行：滚动加载追加下一页时，已在屏幕上的行必须原地不动，
      // 否则整列表会重新从 autoAlpha:0 淡入，视觉上就是一次闪烁。
      // 新搜索的行是全新 DOM 节点（key 变了），自然没有标记，会照常整体入场。
      const fresh = Array.from(
        resultsRef.current.querySelectorAll<HTMLElement>('[data-search-result]:not([data-row-shown])'),
      )
      if (!fresh.length) return
      for (const row of fresh) row.setAttribute('data-row-shown', '')
      if (reducedMotion) {
        gsap.set(fresh, { autoAlpha: 1, y: 0 })
        return
      }
      gsap.fromTo(
        fresh,
        { autoAlpha: 0, y: 8 },
        {
          autoAlpha: 1,
          y: 0,
          duration: motionDurations.base,
          ease: motionEases.standard,
          stagger: 0.025,
          overwrite: 'auto',
        },
      )
      return () => gsap.killTweensOf(fresh)
    },
    {
      scope: resultsRef,
      dependencies: [provider, reducedMotion, resultAnimationKey, searchOpen],
      // 不能 revert：revert 会把已入场行的内联样式还原，追加下一页时又是一次闪烁
      revertOnUpdate: false,
    },
  )

  useGSAP(
    () => {
      const state = providerFlipStateRef.current
      providerFlipStateRef.current = null
      if (!state || reducedMotion) return
      const animation = Flip.from(state, {
        duration: motionDurations.emphasized,
        ease: motionEases.standard,
        absolute: true,
        nested: true,
      })
      return () => animation.kill()
    },
    {
      scope: providerTabsRef,
      dependencies: [providerOrderKey, reducedMotion],
    },
  )

  const dropProvider = (target: ProviderId): void => {
    if (!draggedProvider || draggedProvider === target) return
    const tabs = providerTabsRef.current?.querySelectorAll<HTMLElement>('[data-search-provider]')
    providerFlipStateRef.current = tabs?.length ? Flip.getState(tabs) : null
    setProviderOrder([target, draggedProvider])
    setDraggedProvider(null)
  }

  return (
    <>
      <div
        ref={sensorRef}
        data-search-sensor=""
        className="pointer-events-auto fixed top-0 left-1/2 z-[82] h-8 w-[min(620px,calc(100vw-180px))] -translate-x-1/2 [-webkit-app-region:no-drag]"
        aria-hidden="true"
        onPointerEnter={revealSearch}
        onPointerLeave={scheduleSearchDismiss}
      />
      <div
        ref={searchRef}
        data-search-shell=""
        data-visible={searchVisible || undefined}
        className={cn(
          'pointer-events-auto fixed top-0 left-1/2 h-[26px] w-[min(620px,calc(100vw-180px))] -translate-x-1/2 pt-[15px] [-webkit-app-region:no-drag]',
          searchVisible ? 'z-[83]' : 'z-[81]',
        )}
        onPointerEnter={revealSearch}
        onPointerLeave={scheduleSearchDismiss}
        onFocusCapture={revealSearch}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) scheduleSearchDismiss()
        }}
      >
        <SnapshotAnimatedContent
          visible={searchVisible}
          transitionName="flux-search-shell-vt"
          direction="vertical"
          reverse
          distance={44}
          enterDuration={motionDurations.emphasized}
          exitDuration={motionDurations.base}
          enterEase={motionEases.enter}
          exitEase={motionEases.exit}
          data-search-motion=""
          className="relative w-full pt-2"
        >
          <GlassSurface className="searchbar relative h-[52px] w-full" data-search-glass="">
            <Input
              ref={inputRef}
              value={keyword}
              className={cn(
                'h-[52px] min-h-[52px] w-full rounded-[var(--flux-glass-radius)] border-0 bg-transparent px-[18px] text-sm text-[var(--flux-text)] shadow-none',
                'transition-colors duration-[var(--motion-duration-base)] placeholder:text-[var(--flux-text-muted)]',
                'focus-visible:bg-[color-mix(in_srgb,var(--flux-accent)_5%,transparent)] focus-visible:ring-0 motion-reduce:transition-none',
              )}
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
          </GlassSurface>
          {searchOpen && keyword.trim() ? (
            <GlassSurface
              ref={popoverRef}
              id="search-results-popover"
              data-search-popover=""
              elevation="raised"
              className="absolute top-[69px] left-0 z-[2] max-h-[min(570px,calc(100vh-210px))] w-full"
              role="region"
              aria-label="搜索结果"
            >
              <div
                ref={providerTabsRef}
                data-search-provider-tabs=""
                className="flex min-h-[46px] items-center gap-[5px] border-b border-[var(--flux-panel-border)] px-[9px] py-[7px]"
                role="tablist"
                aria-label="搜索渠道"
              >
                {providerOrder.map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    draggable
                    data-search-provider={item}
                    aria-selected={provider === item}
                    className={cn(
                      'h-8 cursor-pointer rounded-full border border-transparent bg-transparent px-[13px] text-xs text-[var(--flux-text-muted)] transition-[color,background-color,border-color,opacity] duration-[var(--motion-duration-fast)] motion-reduce:transition-none',
                      'hover:text-[var(--flux-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--flux-accent)]',
                      provider === item &&
                        'border-[color-mix(in_srgb,var(--flux-accent)_32%,transparent)] bg-[var(--flux-accent-soft)] text-[var(--flux-text)]',
                      draggedProvider === item && 'opacity-60',
                    )}
                    onDragStart={() => setDraggedProvider(item)}
                    onDragEnd={() => setDraggedProvider(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => dropProvider(item)}
                    onClick={() => onProviderChange(item)}
                  >
                    {item === 'netease' ? '网易云' : 'QQ 音乐'}
                    <small className="ml-[7px] text-[10px] text-[var(--flux-text-muted)]">
                      {item === 'netease' ? neteaseCount : qqCount}
                    </small>
                  </button>
                ))}
                <span className="ml-auto pr-[7px] text-[10px] tracking-[0.08em] text-[var(--flux-text-muted)]">
                  双渠道并行
                </span>
              </div>
              <div
                ref={resultsRef}
                data-search-results=""
                data-scroll-region
                onScroll={handleResultsScroll}
                className={cn(
                  'max-h-[min(510px,calc(100vh-266px))] min-h-0 w-full overflow-y-auto border-0 bg-transparent',
                  '[scrollbar-color:color-mix(in_srgb,var(--flux-panel-border)_18%,transparent)_transparent] [scrollbar-width:thin]',
                  '[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--flux-panel-border)_18%,transparent)]',
                )}
              >
                {songs.length === 0 ? (
                  <div className="px-0 py-[42px] text-center text-[13px] text-[var(--flux-text-muted)]">
                    {activeSearch.isFetching
                      ? '搜索中…'
                      : activeSearch.error instanceof Error
                        ? `搜索失败：${musicErrorMessage(activeSearch.error, '搜索失败')}`
                        : debouncedKeyword
                          ? '没有结果'
                          : '准备搜索…'}
                  </div>
                ) : (
                  <>
                    {songs.map((song, index) => {
                      const key = `${song.provider}-${song.id}`
                      const active = current && `${current.provider}-${current.id}` === key
                      return (
                        <button
                          type="button"
                          key={`${key}-${index}`}
                          data-search-result=""
                          data-active={active || undefined}
                          className={cn(
                            'flex min-h-[62px] w-full cursor-pointer items-center gap-3 border-0 border-b border-[color-mix(in_srgb,var(--flux-panel-border)_55%,transparent)] bg-transparent px-3.5 py-2.5 text-left text-[var(--flux-text)]',
                            'hover:bg-[var(--flux-accent-soft)] focus-visible:bg-[var(--flux-accent-soft)] focus-visible:outline-none',
                            active && 'bg-[var(--flux-accent-soft)]',
                          )}
                          onClick={() => {
                            dismissSearch()
                            setKeyword('')
                            void setQueue([...songs], index)
                          }}
                        >
                          {song.cover ? (
                            <img
                              className="size-[42px] shrink-0 rounded-[10px] bg-[color-mix(in_srgb,var(--flux-panel-border)_9%,transparent)] object-cover"
                              src={coverProxyUrl(song.cover)}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <span className="size-[42px] shrink-0 rounded-[10px] bg-[color-mix(in_srgb,var(--flux-panel-border)_9%,transparent)]" />
                          )}
                          <span className="min-w-0 flex-1">
                            <strong className="block truncate text-sm">{song.name}</strong>
                            <small className="mt-1 block truncate text-xs text-[var(--flux-text-muted)]">
                              {song.artist}
                              {song.album ? ` · ${song.album}` : ''}
                            </small>
                          </span>
                          <span className="text-[11px] text-[var(--flux-text-muted)]">
                            {song.provider === 'qq' ? 'QQ' : '网易云'}
                          </span>
                        </button>
                      )
                    })}
                    {isFetchingNextPage ? (
                      <div
                        className="px-0 py-3 text-center text-[12px] text-[var(--flux-text-muted)]"
                        data-search-loading-more=""
                      >
                        正在加载更多…
                      </div>
                    ) : !hasNextPage ? (
                      <div
                        className="px-0 py-3 text-center text-[12px] text-[var(--flux-text-muted)]"
                        data-search-list-end=""
                      >
                        没有更多结果了
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </GlassSurface>
          ) : null}
        </SnapshotAnimatedContent>
      </div>
    </>
  )
}
