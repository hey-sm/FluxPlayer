import { useEffect, useReducer, useRef } from 'react'
import type { LyricLine } from '@shared/models'
import type { LyricTrackKey } from './paths'
import {
  createLyricsTrackState,
  currentLyricLineIndex,
  lyricsEmptyState,
  lyricsTrackReducer,
  type LyricsEmptyState,
  type LyricsLoadState,
} from './state'
import './lyrics.css'

const EMPTY_COPY: Record<Exclude<LyricsEmptyState, 'none'>, { title: string; detail: string }> = {
  idle: { title: '等待播放', detail: '选择一首歌曲后，歌词会在这里出现' },
  loading: { title: '正在加载歌词', detail: '正在同步歌曲的时间轴' },
  error: { title: '歌词加载失败', detail: '稍后重试，播放不会受到影响' },
  instrumental: { title: '纯音乐，请欣赏', detail: '让旋律接管这一刻' },
  empty: { title: '暂无歌词', detail: '这首歌暂时没有可用歌词' },
}

export interface LyricsViewProps {
  /** Identity of the song currently owned by the player. */
  trackKey: LyricTrackKey | null
  lines: readonly LyricLine[]
  position: number
  loadState: LyricsLoadState
  instrumental?: boolean
  onSeek?: (seconds: number) => void
  className?: string
  'aria-label'?: string
}

/**
 * Time-driven 2D lyrics. Position must come from the player's global-Ticker-synchronized state;
 * this component intentionally owns no clock, RAF, interval, or ticker subscription.
 */
export function LyricsView({
  trackKey,
  lines,
  position,
  loadState,
  instrumental = false,
  onSeek,
  className,
  'aria-label': ariaLabel = '滚动歌词',
}: LyricsViewProps): React.JSX.Element {
  const [track, dispatch] = useReducer(lyricsTrackReducer, undefined, () =>
    createLyricsTrackState(trackKey, loadState === 'success' ? lines : []),
  )
  const activeElement = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    dispatch({ type: 'switch', trackKey })
  }, [trackKey])

  useEffect(() => {
    if (loadState === 'success') dispatch({ type: 'load', trackKey, lines })
    else dispatch({ type: 'clear', trackKey })
  }, [lines, loadState, trackKey])

  // A changed prop key invalidates reducer data during the very same render, before effects run.
  const visibleLines = track.trackKey === trackKey ? track.lines : []
  const activeIndex = currentLyricLineIndex(visibleLines, position)
  const empty = lyricsEmptyState(visibleLines, loadState, instrumental)

  useEffect(() => {
    if (activeIndex < 0 || !activeElement.current) return
    activeElement.current.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  }, [activeIndex, trackKey])

  const classes = ['lyrics-view', className].filter(Boolean).join(' ')
  if (empty !== 'none') {
    const copy = EMPTY_COPY[empty]
    return (
      <section className={classes} aria-label={ariaLabel} data-state={empty}>
        <div className="lyrics-empty" role={empty === 'error' ? 'alert' : 'status'}>
          <span className="lyrics-empty-orbit" aria-hidden="true" />
          <strong>{copy.title}</strong>
          <span>{copy.detail}</span>
        </div>
      </section>
    )
  }

  return (
    <section className={classes} aria-label={ariaLabel} data-state="ready">
      <div className="lyrics-scroll">
        <div className="lyrics-spacer" aria-hidden="true" />
        {visibleLines.map((line, index) => {
          const active = index === activeIndex
          return (
            <button
              key={`${line.time}:${index}`}
              ref={active ? activeElement : undefined}
              type="button"
              className={`lyrics-line${active ? ' is-current' : ''}`}
              aria-current={active ? 'true' : undefined}
              onClick={() => onSeek?.(line.time)}
            >
              <span className="lyrics-line-text">{line.text || '　'}</span>
              {line.ttext ? <span className="lyrics-line-translation">{line.ttext}</span> : null}
            </button>
          )
        })}
        <div className="lyrics-spacer" aria-hidden="true" />
      </div>
    </section>
  )
}
