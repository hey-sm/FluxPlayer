/** server 与宿主（Electron 主进程或独立进程）之间的装配契约 */

export type CredentialKey = 'netease' | 'qq'

export interface CredentialStore {
  get(key: CredentialKey): string
  set(key: CredentialKey, value: string): void
}

export interface ServerConfig {
  host: string
  port: number
  /** 静态资源根目录（新 renderer 构建产物，或 legacy 模式下的旧 public 副本） */
  staticRoot: string
  /** 应用版本号（/api/app/version） */
  appVersion: string
  /** 节拍图磁盘缓存目录（Electron 下为 userData/beatmaps） */
  beatCacheDir: string
  credentials: CredentialStore
  /** legacy 模式标记，仅影响日志与 /api/app/version 输出 */
  legacyMode?: boolean
}
