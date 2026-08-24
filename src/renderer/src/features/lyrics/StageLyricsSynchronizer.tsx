import { useEffect, useMemo } from 'react'
import { usePlaybackProgress, usePlayer } from '../../stores/player'
import { DEFAULT_ACCENT_COLOR, useThemeStore } from '../../theme'
import { stageLyricsChannel } from '../../visual/scene'
import { useEnergySync, useMergedEnergyLines } from './energy-sync'
import { useLyrics } from './query'

export function StageLyricsSynchronizer(): null {
  const current = usePlayer((state) => state.current)
  const position = usePlaybackProgress((state) => state.rawPosition)
  const accentColor = useThemeStore((state) =>
    state.lyricsColorLinked ? state.visualParams.accent : state.lyricsColor,
  )
  const lyrics = useLyrics(current)
  const trackKey = lyrics.trackKey
  const baseLines = useMemo(() => lyrics.data?.lines ?? [], [lyrics.data?.lines])

  // Streaming audio energy analysis: refine estimated word timings.
  useEnergySync(trackKey, baseLines)
  const lines = useMergedEnergyLines(trackKey, baseLines)

  useEffect(() => {
    stageLyricsChannel.set({
      trackKey: lyrics.trackKey,
      lines,
      position,
      accentColor,
      visible: lyrics.loadState === 'success',
    })
  }, [accentColor, lines, lyrics.loadState, lyrics.trackKey, position])

  useEffect(
    () => () =>
      stageLyricsChannel.set({
        trackKey: null,
        lines: [],
        position: 0,
        accentColor: DEFAULT_ACCENT_COLOR,
        visible: false,
      }),
    [],
  )
  return null
}
