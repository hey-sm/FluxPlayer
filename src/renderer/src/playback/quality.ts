import { NETEASE_QUALITY_CANDIDATES, normalizeQualityPreference } from '@shared/models'
import type { QualityLevel } from '@shared/models'

/** 旧版未设置偏好时的默认档；直接取自服务端空值回退，两端永不漂移 */
export const DEFAULT_QUALITY: QualityLevel = normalizeQualityPreference('')

const QUALITY_ORDER: readonly QualityLevel[] = ['jymaster', 'hires', 'lossless', 'exhigh', 'standard']

/** 提示文案用档位名（与旧版 playbackQualityLabel 一致），单一来源取 shared 候选表的 label */
export function qualityLabel(value: unknown): string {
  const q = normalizeQualityPreference(value)
  return NETEASE_QUALITY_CANDIDATES.find((c) => c.level === q)?.label ?? '高清臻音'
}

/**
 * 实际解析档是否低于请求档（网易云降档提示用）。
 * resolved 用原始串判档：未知档位（aac/空串）不判降级，避免 normalize 回退 hires 误报。
 */
export function isQualityDowngrade(requested: QualityLevel, resolvedLevel: unknown): boolean {
  const raw = String(resolvedLevel || '')
    .toLowerCase()
    .trim() as QualityLevel
  if (!QUALITY_ORDER.includes(raw)) return false
  return QUALITY_ORDER.indexOf(raw) > QUALITY_ORDER.indexOf(normalizeQualityPreference(requested))
}
