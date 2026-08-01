import { useQuery } from '@tanstack/react-query'
import type { ProviderId, UnifiedPlaylist } from '@shared/models'
import { coverProxyUrl, normalizeCoverSource } from '../../api'
import { createDiscoverQuery, DISCOVER_STALE_TIME } from './queries'
import { discoverCardVariants, discoverSectionTitleVariants } from './variants'

interface DiscoverPanelProps {
  provider: ProviderId
  /** 登录身份 token；空串表示未登录 —— 未登录不请求也不渲染 */
  identityToken: string
  onOpenPlaylist(playlist: UnifiedPlaylist): void
  onPrefetchPlaylist?(playlist: UnifiedPlaylist): void
}

function DiscoverCard({
  playlist,
  onOpen,
  onPrefetch,
}: {
  playlist: UnifiedPlaylist
  onOpen(): void
  onPrefetch?(): void
}): React.JSX.Element {
  const cover = coverProxyUrl(normalizeCoverSource(playlist.cover || ''))
  return (
    <button
      type="button"
      className={discoverCardVariants()}
      data-discover-card={String(playlist.id)}
      aria-label={`打开歌单 ${playlist.name}`}
      onClick={onOpen}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
    >
      {cover ? (
        <img
          className="aspect-square w-full rounded-[9px] bg-[var(--flux-accent-soft)] object-cover"
          src={cover}
          alt=""
          loading="lazy"
        />
      ) : (
        <span className="aspect-square w-full rounded-[9px] bg-[var(--flux-accent-soft)]" />
      )}
      <span className="line-clamp-2 text-[11px] leading-tight">{playlist.name}</span>
    </button>
  )
}

/**
 * QQ 发现页：个性化推荐 + 排行榜 + 热门歌单。
 * 只在登录后拉取——未登录时上游只回通用内容，没有意义。
 * provider 不支持（网易云）或整块取不到内容时静默隐藏，不占位、不报错。
 */
export function DiscoverPanel({
  provider,
  identityToken,
  onOpenPlaylist,
  onPrefetchPlaylist,
}: DiscoverPanelProps): React.JSX.Element | null {
  const discover = useQuery({
    ...createDiscoverQuery(provider, identityToken),
    enabled: identityToken.length > 0,
    staleTime: DISCOVER_STALE_TIME,
    retry: 1,
  })

  const sections = discover.data?.supported ? discover.data.sections : []
  if (!identityToken || !sections.length) return null

  return (
    <div className="mb-3" data-discover-panel={provider}>
      {sections.map((section) => (
        <section key={section.id} className="mb-2.5 last:mb-0" data-discover-section={section.id}>
          <h3 className={discoverSectionTitleVariants()}>{section.title}</h3>
          <div className="grid grid-cols-3 gap-1.5" data-discover-cards="">
            {section.playlists.map((playlist) => (
              <DiscoverCard
                key={String(playlist.id)}
                playlist={playlist}
                onOpen={() => onOpenPlaylist(playlist)}
                onPrefetch={onPrefetchPlaylist ? () => onPrefetchPlaylist(playlist) : undefined}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
