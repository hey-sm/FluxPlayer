import { app, safeStorage, type SafeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CredentialKey, CredentialStore } from '@server/types'

export interface VerifiedCredentialWriteResult {
  ok: boolean
  verified: boolean
  preservedExisting: boolean
  error?: string
}

export interface SafeCredentialStoreOptions {
  directory?: string
  encryption?: Pick<SafeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString'>
}

/**
 * 凭据存储：safeStorage（Windows DPAPI）加密后落盘 userData/credentials/<key>.bin。
 * 凭据只接受 safeStorage 密文；不读取旧明文格式，也不降级为明文写入。
 */
export class SafeCredentialStore implements CredentialStore {
  private readonly dir: string
  private readonly encryption: Pick<SafeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString'>
  private readonly cache = new Map<CredentialKey, string>()

  constructor(options: SafeCredentialStoreOptions = {}) {
    this.dir = options.directory ?? path.join(app.getPath('userData'), 'credentials')
    this.encryption = options.encryption ?? safeStorage
    try {
      fs.mkdirSync(this.dir, { recursive: true })
    } catch {
      /* Deferred to the verified write path. */
    }
    this.recoverInterruptedReplacements()
  }

  private fileFor(key: CredentialKey): string {
    return path.join(this.dir, `${key}.bin`)
  }

  private replacementJournalFor(key: CredentialKey): string {
    return path.join(this.dir, `${key}.replace.json`)
  }

  private recoverInterruptedReplacements(): void {
    for (const key of ['netease', 'qq'] as const) {
      const journal = this.replacementJournalFor(key)
      if (!fs.existsSync(journal)) continue
      try {
        const record = JSON.parse(fs.readFileSync(journal, 'utf8')) as {
          temporary?: unknown
          previous?: unknown
        }
        if (typeof record.temporary !== 'string' || typeof record.previous !== 'string') {
          throw new Error('INVALID_REPLACEMENT_JOURNAL')
        }
        const temporary = path.resolve(this.dir, record.temporary)
        const previous = path.resolve(this.dir, record.previous)
        if (
          path.dirname(temporary) !== path.resolve(this.dir) ||
          path.dirname(previous) !== path.resolve(this.dir)
        ) {
          throw new Error('REPLACEMENT_JOURNAL_PATH_ESCAPE')
        }
        const file = this.fileFor(key)
        const finalValid = this.isEncryptedCredentialFile(file)
        const previousValid = this.isEncryptedCredentialFile(previous)
        if (finalValid) {
          if (fs.existsSync(previous)) fs.unlinkSync(previous)
        } else if (previousValid) {
          if (fs.existsSync(file)) fs.unlinkSync(file)
          fs.renameSync(previous, file)
        } else {
          if (fs.existsSync(file)) fs.unlinkSync(file)
          if (fs.existsSync(previous)) fs.unlinkSync(previous)
        }
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
        fs.unlinkSync(journal)
      } catch (error: unknown) {
        console.warn(
          `[Credentials] recover ${key} replacement failed:`,
          error instanceof Error ? error.message : error,
        )
      }
    }
  }

  private isEncryptedCredentialFile(file: string): boolean {
    if (!fs.existsSync(file) || !this.encryption.isEncryptionAvailable()) return false
    try {
      const raw = fs.readFileSync(file)
      return raw.subarray(0, 6).toString('utf8') !== 'plain:' && Boolean(this.encryption.decryptString(raw))
    } catch {
      return false
    }
  }

  private readFromDisk(key: CredentialKey): string {
    const file = this.fileFor(key)
    if (!fs.existsSync(file) || !this.encryption.isEncryptionAvailable()) return ''
    const raw = fs.readFileSync(file)
    if (raw.subarray(0, 6).toString('utf8') === 'plain:') return ''
    return this.encryption.decryptString(raw)
  }

  get(key: CredentialKey): string {
    if (this.cache.has(key)) return this.cache.get(key) || ''
    let value = ''
    try {
      value = this.readFromDisk(key)
    } catch (error: unknown) {
      console.warn(`[Credentials] read ${key} failed:`, error instanceof Error ? error.message : error)
    }
    this.cache.set(key, value)
    return value
  }

  /** Normal application writes are encrypted-only; unavailable DPAPI keeps disk state untouched. */
  set(key: CredentialKey, value: string): void {
    if (!value) {
      try {
        const file = this.fileFor(key)
        if (fs.existsSync(file)) fs.unlinkSync(file)
        this.cache.set(key, '')
      } catch (error: unknown) {
        console.warn(`[Credentials] clear ${key} failed:`, error instanceof Error ? error.message : error)
      }
      return
    }

    const result = this.writeApplicationCredential(key, value)
    if (!result.ok) console.warn(`[Credentials] write ${key} failed:`, result.error || 'verification failed')
  }

  /** Normal login/session refresh path: encrypted, verified and allowed to replace an old value. */
  writeApplicationCredential(key: CredentialKey, value: string): VerifiedCredentialWriteResult {
    return this.writeVerified(key, value)
  }

  private writeVerified(key: CredentialKey, value: string): VerifiedCredentialWriteResult {
    if (!value) {
      return { ok: false, verified: false, preservedExisting: false, error: 'EMPTY_CREDENTIAL' }
    }
    if (!this.encryption.isEncryptionAvailable()) {
      return {
        ok: false,
        verified: false,
        preservedExisting: false,
        error: 'SAFE_STORAGE_UNAVAILABLE',
      }
    }

    const file = this.fileFor(key)
    const suffix = `${process.pid}.${randomUUID()}`
    const temporary = `${file}.${suffix}.tmp`
    const previous = `${file}.${suffix}.previous`
    const journal = this.replacementJournalFor(key)
    let movedPrevious = false
    let installedFinal = false
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      const existing = this.readFromDisk(key)
      if (existing === value) {
        this.cache.set(key, value)
        return { ok: true, verified: true, preservedExisting: true }
      }

      const encrypted = this.encryption.encryptString(value)
      if (this.encryption.decryptString(encrypted) !== value) {
        return { ok: false, verified: false, preservedExisting: false, error: 'ENCRYPT_READBACK_MISMATCH' }
      }
      fs.writeFileSync(temporary, encrypted, { flag: 'wx' })
      if (this.encryption.decryptString(fs.readFileSync(temporary)) !== value) {
        throw new Error('TEMP_READBACK_MISMATCH')
      }

      fs.writeFileSync(
        journal,
        JSON.stringify({ temporary: path.basename(temporary), previous: path.basename(previous) }),
        { encoding: 'utf8', flag: 'wx' },
      )
      if (fs.existsSync(file)) {
        fs.renameSync(file, previous)
        movedPrevious = true
      }
      fs.renameSync(temporary, file)
      installedFinal = true
      const finalValue = this.encryption.decryptString(fs.readFileSync(file))
      if (finalValue !== value) throw new Error('FINAL_READBACK_MISMATCH')
      if (movedPrevious && fs.existsSync(previous)) fs.unlinkSync(previous)
      if (fs.existsSync(journal)) fs.unlinkSync(journal)
      this.cache.set(key, value)
      return { ok: true, verified: true, preservedExisting: false }
    } catch (error: unknown) {
      try {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
        if (installedFinal && fs.existsSync(file)) fs.unlinkSync(file)
        if (movedPrevious && fs.existsSync(previous)) {
          if (this.isEncryptedCredentialFile(previous)) fs.renameSync(previous, file)
          else fs.unlinkSync(previous)
        }
        if (fs.existsSync(journal)) fs.unlinkSync(journal)
      } catch {
        /* Recovery is best-effort; the replacement journal is retried on the next startup. */
      }
      return {
        ok: false,
        verified: false,
        preservedExisting: false,
        error: error instanceof Error ? error.message : 'CREDENTIAL_WRITE_FAILED',
      }
    }
  }
}
