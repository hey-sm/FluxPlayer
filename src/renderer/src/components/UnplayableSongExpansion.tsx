import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ProviderId, UnifiedSong } from '@shared/models'
import { coverProxyUrl, searchMusic } from '@/api'
import { cn } from '@/lib/utils'

/** 搜索来源标签。chksz 是聚合 API，其余是直连 provider。 */
type SearchSource = 'chksz' | ProviderId

/** 来源 → 展示名 */
const SOURCE_LABELS: Record<SearchSource, string> = {
  chksz: 'ChKSz',
  netease: '网易云',
  qq: 'QQ 音乐',
}

/**
 * 可用的搜索来源列表：
 * - chksz 已配置 → chksz 放最前，后面跟互补的直连 provider
 * - chksz 未配置 → 只留互补的直连 provider（原行为）
 */
function availableSources(songProvider: ProviderId, chkszActive: boolean): SearchSource[] {
  const alternates = (['netease', 'qq'] as const).filter((p) => p !== songProvider)
  return chkszActive ? ['chksz', ...alternates] : alternates
}

/**
 * 歌曲相似度匹配：用名称和歌手做模糊比对，过滤搜索结果中明显不是同一首歌的条目。
 * 返回 0~1 的得分，>0 表示可接受，越高越匹配。
 *
 * 策略（宽松优先，避免漏掉真正匹配的换源结果）：
 * - 歌曲名包含关系（完全相等 > 原曲名是候选名的子串 > 候选名是原曲名的子串 > 共同子串）
 * - 歌手名至少一个 token 出现在对方歌手字符串里
 * - 翻唱版（候选名含"翻自"/"cover"/"翻唱"）降权但不排除
 */
function songMatchScore(original: { name: string; artist: string }, candidate: UnifiedSong): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[\s(（].*$/, '')
      .replace(/\(.*?\)/g, '')
      .trim()
  const origName = normalize(original.name)
  const candName = normalize(candidate.name)
  const origArtist = normalize(original.artist)
  const candArtist = normalize(candidate.artist)

  // 歌名匹配
  let nameScore = 0
  if (origName && candName) {
    if (origName === candName) nameScore = 1
    else if (candName.includes(origName) || origName.includes(candName)) nameScore = 0.85
    else if (origName.length >= 4 && candName.length >= 4) {
      // 共同字符比例（仅对 >=4 字符的歌名使用，短名太容易误匹配）
      const shorter = origName.length < candName.length ? origName : candName
      const longer = origName.length < candName.length ? candName : origName
      let common = 0
      for (const ch of shorter) if (longer.includes(ch)) common++
      nameScore = common / shorter.length
      if (nameScore < 0.6) nameScore = 0
    }
  }
  if (nameScore === 0) return 0

  // 歌手匹配
  let artistScore = 0
  if (origArtist && candArtist) {
    const origTokens = origArtist
      .split(/[/&,，]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const hasMatch = origTokens.some((token) => candArtist.includes(token) || token.includes(candArtist))
    artistScore = hasMatch ? 1 : 0
  }

  // 翻唱降权
  const isCover = /翻自|cover|翻唱|remix|版/i.test(candidate.name)
  const coverPenalty = isCover ? 0.7 : 1

  return nameScore * (artistScore > 0 ? 1 : 0.7) * coverPenalty
}

interface UnplayableSongExpansionProps {
  song: UnifiedSong
  onPlay(song: UnifiedSong): void
}

/**
 * 无音源歌曲换源面板：点击无音源歌曲时在列表项下方插入的子列表。
 *
 * 来源选择（tab）：
 * - chksz（已配置时排最前）：用 chksz 聚合 API 搜当前歌曲名，结果默认 playable
 * - 互补 provider：直连搜索另一个平台（网易云↔QQ）
 *
 * 选中某个来源时，用歌曲名 + 歌手搜索，通过 songMatchScore 过滤候选。
 * chksz 来源的搜索结果自带 playable=true（chksz 不标记不可播），其余来源过滤掉 playable===false。
 */
export function UnplayableSongExpansion({ song, onPlay }: UnplayableSongExpansionProps): React.JSX.Element {
  const [chkszActive, setChkszActive] = useState(false)
  const sources = useMemo(() => availableSources(song.provider, chkszActive), [song.provider, chkszActive])
  const [selectedSource, setSelectedSource] = useState<SearchSource>(sources[0])

  // 检查 chksz 是否已配置且已启用
  useEffect(() => {
    let active = true
    void window.fluxDesktop?.chksz?.getStatus().then(({ configured, enabled }) => {
      if (!active) return
      const isActive = configured && enabled
      setChkszActive(isActive)
      if (isActive) setSelectedSource('chksz')
    })
    return () => {
      active = false
    }
  }, [])

  const { data, isLoading, error } = useQuery({
    queryKey: ['unplayable-cross-search', selectedSource, song.provider, song.name, song.artist],
    queryFn: async ({ signal }) => {
      const alternateProvider: ProviderId = song.provider === 'netease' ? 'qq' : 'netease'
      if (selectedSource === 'chksz') {
        // chksz 搜索互补平台：网易云无音源 → 搜 QQ，QQ 无音源 → 搜网易云
        return searchMusic(
          {
            provider: alternateProvider,
            keywords: `${song.name} ${song.artist}`,
            limit: 20,
            page: 1,
            backend: 'chksz',
          },
          signal,
        )
      }
      // 直连搜索互补平台
      return searchMusic(
        {
          provider: selectedSource,
          keywords: `${song.name} ${song.artist}`,
          limit: 20,
          page: 1,
          backend: 'direct',
        },
        signal,
      )
    },
    enabled: Boolean(song.name),
    staleTime: 60_000,
  })

  const matchedCandidates = useMemo(() => {
    const all = data?.songs ?? []
    // chksz 结果自带 playable=true；直连结果需过滤掉不可播的候选
    const playable = all.filter((s: UnifiedSong) => s.playable !== false)
    const scored = playable
      .map((s: UnifiedSong) => ({
        song: s,
        score: songMatchScore({ name: song.name, artist: song.artist }, s),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((entry) => entry.song)
    return scored
  }, [data, song.name, song.artist])

  return (
    <div
      className="bg-[color-mix(in_srgb,var(--flux-glass-background)_82%,transparent)]"
      data-unplayable-expansion=""
      onClick={(e) => e.stopPropagation()}
    >
      {/* 抬头：无音源提示 + 来源切换 */}
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <span className="text-[11px] text-[var(--flux-text-muted)]">无音源 · 换源播放</span>
        <div className="ml-auto flex items-center gap-1" role="tablist" aria-label="换源选择">
          {sources.map((src) => (
            <button
              key={src}
              role="tab"
              type="button"
              aria-selected={selectedSource === src}
              className={cn(
                'h-6 rounded-full border px-2 text-[10px] transition-colors',
                selectedSource === src
                  ? 'border-[color-mix(in_srgb,var(--flux-accent)_32%,transparent)] bg-[var(--flux-accent-soft)] text-[var(--flux-text)]'
                  : 'border-transparent text-[var(--flux-text-muted)] hover:text-[var(--flux-text)]',
              )}
              onClick={() => setSelectedSource(src)}
            >
              {SOURCE_LABELS[src]}
            </button>
          ))}
        </div>
      </div>

      {/* 候选列表 */}
      <div className="px-1.5 pb-1.5">
        {isLoading ? (
          <div className="px-2 py-2 text-[11px] text-[var(--flux-text-muted)]">
            正在搜索 {SOURCE_LABELS[selectedSource]}…
          </div>
        ) : error ? (
          <div className="px-2 py-2 text-[11px] text-[var(--flux-text-muted)]">
            {SOURCE_LABELS[selectedSource]} 搜索失败：
            {error instanceof Error ? error.message.slice(0, 100) : '请稍后重试'}
          </div>
        ) : matchedCandidates.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-[var(--flux-text-muted)]">
            {SOURCE_LABELS[selectedSource]} 未找到匹配的可播放结果
          </div>
        ) : (
          matchedCandidates.map((candidate) => (
            <button
              key={`${candidate.provider}:${candidate.id}`}
              type="button"
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--flux-accent-soft)]"
              onClick={() => onPlay(candidate)}
            >
              {candidate.cover ? (
                <img
                  className="size-8 shrink-0 rounded-md object-cover"
                  src={coverProxyUrl(candidate.cover)}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <span className="size-8 shrink-0 rounded-md bg-[color-mix(in_srgb,var(--flux-panel-border)_7%,transparent)]" />
              )}
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-xs">{candidate.name}</strong>
                <small className="block truncate text-[10px] text-[var(--flux-text-muted)]">
                  {candidate.artist}
                  {candidate.album ? ` · ${candidate.album}` : ''}
                </small>
              </span>
              <span className="text-[10px] text-[var(--flux-text-muted)]">
                {SOURCE_LABELS[candidate.provider]}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
