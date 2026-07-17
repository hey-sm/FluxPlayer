import * as z from 'zod/mini'

export const providerIdSchema = z.enum(['netease', 'qq'])
export const qualityLevelSchema = z.enum(['jymaster', 'hires', 'lossless', 'exhigh', 'standard'])

const identifierSchema = z.union([z.string().check(z.minLength(1)), z.number()])
const optionalIdentifierSchema = z.optional(z.union([z.string(), z.number()]))
const positiveLimitSchema = z.optional(z.int().check(z.gte(1), z.lte(200)))

const artistSchema = z.object({
  id: optionalIdentifierSchema,
  mid: z.optional(z.string()),
  name: z.string(),
})

export const unifiedSongSchema = z.object({
  provider: providerIdSchema,
  type: z.string(),
  id: identifierSchema,
  name: z.string(),
  artist: z.string(),
  artists: z.array(artistSchema),
  artistId: optionalIdentifierSchema,
  album: z.string(),
  cover: z.string(),
  duration: z.number(),
  fee: z.optional(z.number()),
  qqId: optionalIdentifierSchema,
  mid: z.optional(z.string()),
  songmid: z.optional(z.string()),
  mediaMid: z.optional(z.string()),
  artistMid: z.optional(z.string()),
  albumMid: z.optional(z.string()),
  playable: z.optional(z.boolean()),
})

export const musicSearchRequestSchema = z.object({
  provider: providerIdSchema,
  keywords: z.string().check(z.minLength(1), z.maxLength(200)),
  limit: positiveLimitSchema,
})

export const playbackResolveRequestSchema = z.object({
  song: unifiedSongSchema,
  quality: qualityLevelSchema,
})

export const lyricsRequestSchema = z.object({
  provider: providerIdSchema,
  id: identifierSchema,
  mid: z.optional(z.string()),
})

export const providerRequestSchema = z.object({ provider: providerIdSchema })

export const playlistListRequestSchema = z.object({
  provider: providerIdSchema,
  limit: positiveLimitSchema,
})

export const playlistTracksRequestSchema = z.object({
  provider: providerIdSchema,
  id: identifierSchema,
})

export const likedTracksRequestSchema = z.object({
  provider: providerIdSchema,
  offset: z.optional(z.int().check(z.gte(0))),
  limit: positiveLimitSchema,
})

export type MusicRequestSchema =
  | typeof musicSearchRequestSchema
  | typeof playbackResolveRequestSchema
  | typeof lyricsRequestSchema
  | typeof providerRequestSchema
  | typeof playlistListRequestSchema
  | typeof playlistTracksRequestSchema
  | typeof likedTracksRequestSchema
