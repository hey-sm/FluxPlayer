import type { UnifiedSong } from '@shared/models'

/** 统一的 UnifiedSong 测试工厂：模型加必填字段只需改这里。 */
export function makeSong(partial: Partial<UnifiedSong> = {}): UnifiedSong {
  return {
    provider: 'qq',
    type: 'song',
    id: 1,
    name: '',
    artist: '',
    artists: [],
    album: '',
    cover: '',
    duration: 0,
    ...partial,
  }
}
