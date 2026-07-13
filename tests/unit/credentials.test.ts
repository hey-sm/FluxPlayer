import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('Tests must inject a credential directory')
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('Tests must inject encryption')
    },
    decryptString: () => {
      throw new Error('Tests must inject encryption')
    },
  },
}))

import { SafeCredentialStore } from '../../src/main/credentials'

const ENCRYPTED_PREFIX = 'test-encrypted:'
const temporaryDirectories: string[] = []

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxplayer-credentials-'))
  temporaryDirectories.push(directory)
  return directory
}

function decodeEncrypted(raw: Buffer): string {
  const serialized = raw.toString('utf8')
  if (!serialized.startsWith(ENCRYPTED_PREFIX)) throw new Error('INVALID_CIPHERTEXT')
  return serialized.slice(ENCRYPTED_PREFIX.length)
}

function createEncryption(available = true) {
  return {
    isEncryptionAvailable: vi.fn(() => available),
    encryptString: vi.fn((value: string) => Buffer.from(`${ENCRYPTED_PREFIX}${value}`, 'utf8')),
    decryptString: vi.fn((raw: Buffer) => decodeEncrypted(raw)),
  }
}

function credentialFile(directory: string, key: 'netease' | 'qq' = 'netease'): string {
  return path.join(directory, `${key}.bin`)
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('SafeCredentialStore', () => {
  it('does not write a credential file when safeStorage encryption is unavailable', () => {
    const directory = createTemporaryDirectory()
    const encryption = createEncryption(false)
    const store = new SafeCredentialStore({ directory, encryption })

    expect(store.writeApplicationCredential('netease', 'MUSIC_U=secret')).toEqual({
      ok: false,
      verified: false,
      preservedExisting: false,
      error: 'SAFE_STORAGE_UNAVAILABLE',
    })
    expect(encryption.encryptString).not.toHaveBeenCalled()
    expect(fs.readdirSync(directory)).toEqual([])
  })

  it('writes encrypted bytes, verifies the final file, and reads the value back from a fresh store', () => {
    const directory = createTemporaryDirectory()
    const encryption = createEncryption()
    const value = 'MUSIC_U=encrypted-cookie'
    const store = new SafeCredentialStore({ directory, encryption })

    expect(store.writeApplicationCredential('netease', value)).toEqual({
      ok: true,
      verified: true,
      preservedExisting: false,
    })
    expect(encryption.decryptString).toHaveBeenCalledTimes(3)
    expect(fs.readFileSync(credentialFile(directory)).toString('utf8')).toBe(`${ENCRYPTED_PREFIX}${value}`)
    expect(fs.readdirSync(directory)).toEqual(['netease.bin'])

    const reloaded = new SafeCredentialStore({ directory, encryption })
    expect(reloaded.get('netease')).toBe(value)
  })

  it('atomically upgrades an old plain: file when it contains the same value', () => {
    const directory = createTemporaryDirectory()
    const file = credentialFile(directory)
    const value = 'MUSIC_U=legacy-cookie'
    fs.writeFileSync(file, `plain:${value}`, 'utf8')
    const encryption = createEncryption()
    const rename = vi.spyOn(fs, 'renameSync')
    const store = new SafeCredentialStore({ directory, encryption })

    expect(store.writeApplicationCredential('netease', value)).toEqual({
      ok: true,
      verified: true,
      preservedExisting: false,
    })
    expect(rename).toHaveBeenCalledTimes(2)
    expect(rename.mock.calls[0][0]).toBe(file)
    expect(String(rename.mock.calls[0][1])).toMatch(/\.previous$/)
    expect(String(rename.mock.calls[1][0])).toMatch(/\.tmp$/)
    expect(rename.mock.calls[1][1]).toBe(file)
    expect(fs.readFileSync(file).toString('utf8')).toBe(`${ENCRYPTED_PREFIX}${value}`)
    expect(fs.readdirSync(directory)).toEqual(['netease.bin'])
  })

  it('restores the old plaintext when final encrypted-file readback fails', () => {
    const directory = createTemporaryDirectory()
    const file = credentialFile(directory)
    const value = 'MUSIC_U=must-survive'
    fs.writeFileSync(file, `plain:${value}`, 'utf8')
    const encryption = createEncryption()
    encryption.decryptString
      .mockImplementationOnce((raw) => decodeEncrypted(raw))
      .mockImplementationOnce((raw) => decodeEncrypted(raw))
      .mockImplementationOnce(() => 'wrong-final-value')
    const store = new SafeCredentialStore({ directory, encryption })

    expect(store.writeApplicationCredential('netease', value)).toEqual({
      ok: false,
      verified: false,
      preservedExisting: false,
      error: 'FINAL_READBACK_MISMATCH',
    })
    expect(fs.readFileSync(file).toString('utf8')).toBe(`plain:${value}`)
    expect(fs.readdirSync(directory)).toEqual(['netease.bin'])
    expect(store.get('netease')).toBe(value)
  })

  it('allows normal credential refresh to replace a different encrypted value', () => {
    const directory = createTemporaryDirectory()
    const encryption = createEncryption()
    const store = new SafeCredentialStore({ directory, encryption })
    store.set('qq', 'uin=old')

    store.set('qq', 'uin=refreshed')

    expect(store.get('qq')).toBe('uin=refreshed')
    expect(new SafeCredentialStore({ directory, encryption }).get('qq')).toBe('uin=refreshed')
    expect(fs.readdirSync(directory)).toEqual(['qq.bin'])
  })

  it('keeps the cached and on-disk credential when clearing the file fails', () => {
    const directory = createTemporaryDirectory()
    const encryption = createEncryption()
    const store = new SafeCredentialStore({ directory, encryption })
    store.set('netease', 'MUSIC_U=keep-me')
    expect(store.get('netease')).toBe('MUSIC_U=keep-me')
    vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
      throw new Error('access denied')
    })

    store.set('netease', '')

    expect(store.get('netease')).toBe('MUSIC_U=keep-me')
    expect(new SafeCredentialStore({ directory, encryption }).get('netease')).toBe('MUSIC_U=keep-me')
  })

  it('recovers an interrupted encrypted replacement from its journal', () => {
    const directory = createTemporaryDirectory()
    const encryption = createEncryption()
    const file = credentialFile(directory)
    const previous = `${file}.crash.previous`
    const temporary = `${file}.crash.tmp`
    fs.writeFileSync(previous, `${ENCRYPTED_PREFIX}old`, 'utf8')
    fs.writeFileSync(temporary, `${ENCRYPTED_PREFIX}new`, 'utf8')
    fs.writeFileSync(
      path.join(directory, 'netease.replace.json'),
      JSON.stringify({ temporary: path.basename(temporary), previous: path.basename(previous) }),
      'utf8',
    )

    const recovered = new SafeCredentialStore({ directory, encryption })

    expect(recovered.get('netease')).toBe('old')
    expect(fs.readdirSync(directory)).toEqual(['netease.bin'])
  })

})
