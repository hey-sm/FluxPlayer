import { useEffect, useMemo } from 'react'
import { usePlayer } from '../../stores/player'
import { useThemeStore } from '../../theme'
import { stageLyricsChannel } from '../../visual/scene'
import { useLyrics } from './query'

export function StageLyricsSynchronizer(): null {
  const current = usePlayer((state) => state.current)
  const position = usePlayer((state) => state.position)
  const accentColor = useThemeStore((state) => state.visualParams.accent)
  const lyrics = useLyrics(current)
  const lines = useMemo(() => lyrics.data?.lines ?? [], [lyrics.data?.lines])

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
        accentColor: '#7c8cff',
        visible: false,
      }),
    [],
  )
  return null
}
