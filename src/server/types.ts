/** server 与宿主（Electron 主进程或独立进程）之间的装配契约 */

export type CredentialKey = 'netease' | 'qq'

export interface CredentialStore {
  get(key: CredentialKey): string
  set(key: CredentialKey, value: string): void
}

export interface ServerConfig {
  host: string
  port: number
  /** 静态资源根目录（renderer 构建产物） */
  staticRoot: string
  /** 应用版本号（/api/app/version） */
  appVersion: string
  credentials: CredentialStore
}
