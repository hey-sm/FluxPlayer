import type { ProviderId } from '@shared/models'
import type { PageRequest } from './pagination'
import { normalizePageRequest } from './pagination'

export const libraryQueryKeys = {
  all: ['library'] as const,
  identity: (provider: ProviderId, identityToken: string) => ['library', provider, identityToken] as const,
  liked: (provider: ProviderId, identityToken: string, request: PageRequest = {}) => {
    const page = normalizePageRequest(request)
    return ['library', provider, identityToken, 'liked', page.offset, page.limit] as const
  },
  recent: (provider: ProviderId, identityToken: string) =>
    ['library', provider, identityToken, 'recent'] as const,
}
