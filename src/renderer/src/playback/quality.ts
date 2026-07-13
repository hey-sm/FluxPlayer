/**
 * QQ 播放音质降档策略 —— 逐行为移植旧 public/index.html 的
 * qqPlaybackRetryQualities / retryQQPlaybackWithCompatibleQuality（纯逻辑部分）。
 * QQ 常对高音质返回 purl 但 CDN 拒流（403 → "no supported source"），
 * 唯一有效自救是降档重新取链。
 */
import { NETEASE_QUALITY_CANDIDATES, normalizeQualityPreference } from '@shared/models'
import type { QualityLevel } from '@shared/models'

/** 旧版未设置偏好时的默认档；直接取自服务端空值回退，两端永不漂移 */
export const DEFAULT_QUALITY: QualityLevel = normalizeQualityPreference('')

const QUALITY_ORDER: readonly QualityLevel[] = ['jymaster', 'hires', 'lossless', 'exhigh', 'standard']

/**
 * 降档候选池：高三档（jymaster/hires/lossless）→ [exhigh, standard]；
 * exhigh → [standard]；standard 及以下无候选。
 * resolvedLevel 用原始小写串比对（旧版如此），normalize 只做在 requested 上。
 */
export function qqRetryQualityPool(requested: QualityLevel, resolvedLevel: string): QualityLevel[] {
  const resolved = String(resolvedLevel || '').toLowerCase()
  let pool: QualityLevel[] = []
  if (
    requested === 'jymaster' ||
    requested === 'hires' ||
    requested === 'lossless' ||
    resolved === 'hires' ||
    resolved === 'lossless'
  ) {
    pool = ['exhigh', 'standard']
  } else if (requested === 'exhigh' || resolved === 'exhigh') {
    pool = ['standard']
  }
  return pool.filter((q) => q !== requested)
}

/** 池子去掉已试档位后的第一个候选；没有则 null（编排层据此转入换源） */
export function nextQQRetryQuality(
  requested: QualityLevel,
  resolvedLevel: string,
  tried: ReadonlySet<string>,
): QualityLevel | null {
  const pool = qqRetryQualityPool(requested, resolvedLevel).filter((q) => !tried.has(q))
  return pool.length ? pool[0] : null
}

/**
 * 会话级音质天花板：降档时若"已解析档位"归一化后是 hires/lossless 则记为 nextQuality。
 * 注意 normalizeQualityPreference 对空值/未知值回退 'hires'，因此取链失败（无 level）
 * 的重试也会记天花板——这是旧版实测行为（避免整个会话反复撞高音质 403），刻意保留。
 */
export function qqCeilingFromResolved(resolvedLevel: unknown, nextQuality: QualityLevel): QualityLevel | null {
  const resolved = normalizeQualityPreference(resolvedLevel)
  return resolved === 'hires' || resolved === 'lossless' ? nextQuality : null
}

/** 高三档请求被会话天花板压档；exhigh/standard 请求不受影响 */
export function applyQQQualityCeiling(requested: QualityLevel, ceiling: QualityLevel | null): QualityLevel {
  if (!ceiling) return requested
  if (requested === 'jymaster' || requested === 'hires' || requested === 'lossless') return ceiling
  return requested
}

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
