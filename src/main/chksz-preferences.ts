import fs from 'node:fs'
import path from 'node:path'

/**
 * ChKSz 启用状态持久化。
 *
 * 密钥本身存在 SafeCredentialStore（DPAPI 加密），这里只存一个布尔：密钥是否启用。
 * 用户点「停用」时不清除密钥、只把 enabled 置 false；再点「启用」即可恢复，无需重新输入。
 */
const PREFERENCES_FILE = 'chksz-preferences.json'

export interface ChkszPreferences {
  enabled: boolean
}

export class ChkszPreferenceStore {
  private readonly filePath: string
  private state: ChkszPreferences

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, PREFERENCES_FILE)
    this.state = this.read()
  }

  private read(): ChkszPreferences {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<ChkszPreferences>
      return { enabled: raw.enabled !== false }
    } catch {
      return { enabled: true }
    }
  }

  private persist(): void {
    try {
      const temporary = `${this.filePath}.${process.pid}.tmp`
      fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), 'utf8')
      fs.renameSync(temporary, this.filePath)
    } catch (error) {
      console.warn('[ChKSz] preferences persist failed:', error instanceof Error ? error.message : error)
    }
  }

  get enabled(): boolean {
    return this.state.enabled
  }

  setEnabled(enabled: boolean): void {
    this.state = { enabled }
    this.persist()
  }
}
