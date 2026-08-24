/**
 * QQ Music QRC decryption — custom DES (Brad Conte's des.c port) + 3DES + zlib.
 *
 * QQ Music's QRC encrypted lyrics use 3DES ECB with a 24-byte key, followed by
 * zlib inflate. The DES implementation is based on Brad Conte's des.c
 * (https://github.com/B-Con/crypto-algorithms), which has S-box values that
 * differ from the FIPS 46-3 standard at sbox2[23]=15 (FIPS: 14) and
 * sbox4[53]=10 (FIPS: 1). QQ Music's QQMusicCommon.dll uses these exact
 * S-boxes, so OpenSSL's standard DES cannot decrypt the data — a pure JS
 * port is required.
 *
 * Algorithm: 3DES ECB decrypt with 24-byte key, then zlib inflate.
 * Key: "!@#)(*$%123ZXC!@!@#)(NHL" (24 bytes, from 163MusicLyrics)
 *
 * Reference: https://github.com/B-Con/crypto-algorithms (des.c)
 *            https://github.com/jitwxs/163MusicLyrics (QQMusicearchUtils.cs)
 */

import { inflateSync } from 'node:zlib'

// --- Constants ---

const ENCRYPT = 1
const DECRYPT = 0

// Brad Conte's des.c S-boxes (from https://github.com/B-Con/crypto-algorithms)
// These differ from FIPS 46-3 standard: sbox2[23]=15 (std: 14), sbox4[53]=10 (std: 1).
// QQ Music's QQMusicCommon.dll uses these exact S-boxes.
// NOTE: 163MusicLyrics' C# port has additional typos (sbox2[23]=15, sbox4[53]=10)
// that happen to match Brad Conte's original. We use Brad Conte's original values.
const sbox1 = [
  14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
  4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13,
]
// 163MusicLyrics C# values: sbox2[23]=15 (matches Brad Conte, NOT FIPS standard 14)
const sbox2 = [
  15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5,
  0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9,
]
const sbox3 = [
  10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
  13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12,
]
// 163MusicLyrics C# values: sbox4[53]=10 (matches Brad Conte, NOT FIPS standard 1)
const sbox4 = [
  7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
  10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14,
]
const sbox5 = [
  2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
  4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3,
]
const sbox6 = [
  12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
  9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13,
]
const sbox7 = [
  4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
  1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12,
]
const sbox8 = [
  13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
  7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11,
]

const key_rnd_shift = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]
const key_perm_c = [
  56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35,
]
const key_perm_d = [
  62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3,
]
const key_compression = [
  13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36, 46,
  54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31,
]

// --- Bit manipulation ---

function BITNUM(a: Uint8Array, b: number, c: number): number {
  const byteIndex = Math.floor(b / 32) * 4 + 3 - Math.floor((b % 32) / 8)
  const bitPosition = 7 - (b % 8)
  return (((a[byteIndex] >> bitPosition) & 0x01) << c) >>> 0
}

function BITNUMINTR(a: number, b: number, c: number): number {
  return (((a >>> (31 - b)) & 0x00000001) << c) >>> 0
}

function BITNUMINTL(a: number, b: number, c: number): number {
  // C macro: ((a << b) & 0x80000000) >> c
  // In Brad Conte's des.c, state is uint32_t, so >> is logical (unsigned) shift.
  // JS << overflows to signed, so mask to 32-bit unsigned first.
  return (((a << b) & 0x80000000) >>> 0) >>> c
}

function SBOXBIT(a: number): number {
  return ((a & 0x20) | ((a & 0x1f) >> 1) | ((a & 0x01) << 4)) >>> 0
}

// --- Key schedule ---

function keySchedule(key: Uint8Array, mode: number): Uint8Array[] {
  const schedule: Uint8Array[] = new Array(16)
  for (let i = 0; i < 16; i++) schedule[i] = new Uint8Array(6)

  let C = 0
  for (let i = 0, j = 31; i < 28; i++, j--) {
    C = (C | BITNUM(key, key_perm_c[i], j)) >>> 0
  }
  let D = 0
  for (let i = 0, j = 31; i < 28; i++, j--) {
    D = (D | BITNUM(key, key_perm_d[i], j)) >>> 0
  }

  for (let i = 0; i < 16; i++) {
    C = (((C << key_rnd_shift[i]) | (C >>> (28 - key_rnd_shift[i]))) & 0xfffffff0) >>> 0
    D = (((D << key_rnd_shift[i]) | (D >>> (28 - key_rnd_shift[i]))) & 0xfffffff0) >>> 0

    const toGen = mode === DECRYPT ? 15 - i : i
    const sk = new Uint8Array(6)
    for (let j = 0; j < 24; j++) {
      sk[Math.floor(j / 8)] |= BITNUMINTR(C, key_compression[j], 7 - (j % 8))
    }
    for (let j = 24; j < 48; j++) {
      sk[Math.floor(j / 8)] |= BITNUMINTR(D, key_compression[j] - 27, 7 - (j % 8))
    }
    schedule[toGen] = sk
  }
  return schedule
}

// --- IP / InvIP ---

function IP(input: Uint8Array): [number, number] {
  const s0 =
    (BITNUM(input, 57, 31) |
      BITNUM(input, 49, 30) |
      BITNUM(input, 41, 29) |
      BITNUM(input, 33, 28) |
      BITNUM(input, 25, 27) |
      BITNUM(input, 17, 26) |
      BITNUM(input, 9, 25) |
      BITNUM(input, 1, 24) |
      BITNUM(input, 59, 23) |
      BITNUM(input, 51, 22) |
      BITNUM(input, 43, 21) |
      BITNUM(input, 35, 20) |
      BITNUM(input, 27, 19) |
      BITNUM(input, 19, 18) |
      BITNUM(input, 11, 17) |
      BITNUM(input, 3, 16) |
      BITNUM(input, 61, 15) |
      BITNUM(input, 53, 14) |
      BITNUM(input, 45, 13) |
      BITNUM(input, 37, 12) |
      BITNUM(input, 29, 11) |
      BITNUM(input, 21, 10) |
      BITNUM(input, 13, 9) |
      BITNUM(input, 5, 8) |
      BITNUM(input, 63, 7) |
      BITNUM(input, 55, 6) |
      BITNUM(input, 47, 5) |
      BITNUM(input, 39, 4) |
      BITNUM(input, 31, 3) |
      BITNUM(input, 23, 2) |
      BITNUM(input, 15, 1) |
      BITNUM(input, 7, 0)) >>>
    0

  const s1 =
    (BITNUM(input, 56, 31) |
      BITNUM(input, 48, 30) |
      BITNUM(input, 40, 29) |
      BITNUM(input, 32, 28) |
      BITNUM(input, 24, 27) |
      BITNUM(input, 16, 26) |
      BITNUM(input, 8, 25) |
      BITNUM(input, 0, 24) |
      BITNUM(input, 58, 23) |
      BITNUM(input, 50, 22) |
      BITNUM(input, 42, 21) |
      BITNUM(input, 34, 20) |
      BITNUM(input, 26, 19) |
      BITNUM(input, 18, 18) |
      BITNUM(input, 10, 17) |
      BITNUM(input, 2, 16) |
      BITNUM(input, 60, 15) |
      BITNUM(input, 52, 14) |
      BITNUM(input, 44, 13) |
      BITNUM(input, 36, 12) |
      BITNUM(input, 28, 11) |
      BITNUM(input, 20, 10) |
      BITNUM(input, 12, 9) |
      BITNUM(input, 4, 8) |
      BITNUM(input, 62, 7) |
      BITNUM(input, 54, 6) |
      BITNUM(input, 46, 5) |
      BITNUM(input, 38, 4) |
      BITNUM(input, 30, 3) |
      BITNUM(input, 22, 2) |
      BITNUM(input, 14, 1) |
      BITNUM(input, 6, 0)) >>>
    0

  return [s0, s1]
}

function invIP(s0: number, s1: number): Uint8Array {
  const out = new Uint8Array(8)
  const g = (s: number, b: number) => BITNUMINTR(s, b, 0)

  out[3] =
    (g(s1, 7) << 7) |
    (g(s0, 7) << 6) |
    (g(s1, 15) << 5) |
    (g(s0, 15) << 4) |
    (g(s1, 23) << 3) |
    (g(s0, 23) << 2) |
    (g(s1, 31) << 1) |
    g(s0, 31)
  out[2] =
    (g(s1, 6) << 7) |
    (g(s0, 6) << 6) |
    (g(s1, 14) << 5) |
    (g(s0, 14) << 4) |
    (g(s1, 22) << 3) |
    (g(s0, 22) << 2) |
    (g(s1, 30) << 1) |
    g(s0, 30)
  out[1] =
    (g(s1, 5) << 7) |
    (g(s0, 5) << 6) |
    (g(s1, 13) << 5) |
    (g(s0, 13) << 4) |
    (g(s1, 21) << 3) |
    (g(s0, 21) << 2) |
    (g(s1, 29) << 1) |
    g(s0, 29)
  out[0] =
    (g(s1, 4) << 7) |
    (g(s0, 4) << 6) |
    (g(s1, 12) << 5) |
    (g(s0, 12) << 4) |
    (g(s1, 20) << 3) |
    (g(s0, 20) << 2) |
    (g(s1, 28) << 1) |
    g(s0, 28)
  out[7] =
    (g(s1, 3) << 7) |
    (g(s0, 3) << 6) |
    (g(s1, 11) << 5) |
    (g(s0, 11) << 4) |
    (g(s1, 19) << 3) |
    (g(s0, 19) << 2) |
    (g(s1, 27) << 1) |
    g(s0, 27)
  out[6] =
    (g(s1, 2) << 7) |
    (g(s0, 2) << 6) |
    (g(s1, 10) << 5) |
    (g(s0, 10) << 4) |
    (g(s1, 18) << 3) |
    (g(s0, 18) << 2) |
    (g(s1, 26) << 1) |
    g(s0, 26)
  out[5] =
    (g(s1, 1) << 7) |
    (g(s0, 1) << 6) |
    (g(s1, 9) << 5) |
    (g(s0, 9) << 4) |
    (g(s1, 17) << 3) |
    (g(s0, 17) << 2) |
    (g(s1, 25) << 1) |
    g(s0, 25)
  out[4] =
    (g(s1, 0) << 7) |
    (g(s0, 0) << 6) |
    (g(s1, 8) << 5) |
    (g(s0, 8) << 4) |
    (g(s1, 16) << 3) |
    (g(s0, 16) << 2) |
    (g(s1, 24) << 1) |
    g(s0, 24)
  return out
}

// --- Feistel F ---

function feistelF(state: number, key: Uint8Array): number {
  const lrg = new Uint8Array(6)

  const t1 =
    BITNUMINTL(state, 31, 0) |
    ((state & 0xf0000000) >>> 1) |
    BITNUMINTL(state, 4, 5) |
    BITNUMINTL(state, 3, 6) |
    ((state & 0x0f000000) >>> 3) |
    BITNUMINTL(state, 8, 11) |
    BITNUMINTL(state, 7, 12) |
    ((state & 0x00f00000) >>> 5) |
    BITNUMINTL(state, 12, 17) |
    BITNUMINTL(state, 11, 18) |
    ((state & 0x000f0000) >>> 7) |
    BITNUMINTL(state, 16, 23)

  const t2 =
    BITNUMINTL(state, 15, 0) |
    ((state & 0x0000f000) << 15) |
    BITNUMINTL(state, 20, 5) |
    BITNUMINTL(state, 19, 6) |
    ((state & 0x00000f00) << 13) |
    BITNUMINTL(state, 24, 11) |
    BITNUMINTL(state, 23, 12) |
    ((state & 0x000000f0) << 11) |
    BITNUMINTL(state, 28, 17) |
    BITNUMINTL(state, 27, 18) |
    ((state & 0x0000000f) << 9) |
    BITNUMINTL(state, 0, 23)

  lrg[0] = (t1 >>> 24) & 0xff
  lrg[1] = (t1 >>> 16) & 0xff
  lrg[2] = (t1 >>> 8) & 0xff
  lrg[3] = (t2 >>> 24) & 0xff
  lrg[4] = (t2 >>> 16) & 0xff
  lrg[5] = (t2 >>> 8) & 0xff

  for (let i = 0; i < 6; i++) lrg[i] ^= key[i]

  let s: number =
    (sbox1[SBOXBIT(lrg[0] >> 2)] << 28) |
    (sbox2[SBOXBIT(((lrg[0] & 0x03) << 4) | (lrg[1] >> 4))] << 24) |
    (sbox3[SBOXBIT(((lrg[1] & 0x0f) << 2) | (lrg[2] >> 6))] << 20) |
    (sbox4[SBOXBIT(lrg[2] & 0x3f)] << 16) |
    (sbox5[SBOXBIT(lrg[3] >> 2)] << 12) |
    (sbox6[SBOXBIT(((lrg[3] & 0x03) << 4) | (lrg[4] >> 4))] << 8) |
    (sbox7[SBOXBIT(((lrg[4] & 0x0f) << 2) | (lrg[5] >> 6))] << 4) |
    sbox8[SBOXBIT(lrg[5] & 0x3f)]
  s = s >>> 0

  s =
    (BITNUMINTL(s, 15, 0) |
      BITNUMINTL(s, 6, 1) |
      BITNUMINTL(s, 19, 2) |
      BITNUMINTL(s, 20, 3) |
      BITNUMINTL(s, 28, 4) |
      BITNUMINTL(s, 11, 5) |
      BITNUMINTL(s, 27, 6) |
      BITNUMINTL(s, 16, 7) |
      BITNUMINTL(s, 0, 8) |
      BITNUMINTL(s, 14, 9) |
      BITNUMINTL(s, 22, 10) |
      BITNUMINTL(s, 25, 11) |
      BITNUMINTL(s, 4, 12) |
      BITNUMINTL(s, 17, 13) |
      BITNUMINTL(s, 30, 14) |
      BITNUMINTL(s, 9, 15) |
      BITNUMINTL(s, 1, 16) |
      BITNUMINTL(s, 7, 17) |
      BITNUMINTL(s, 23, 18) |
      BITNUMINTL(s, 13, 19) |
      BITNUMINTL(s, 31, 20) |
      BITNUMINTL(s, 26, 21) |
      BITNUMINTL(s, 2, 22) |
      BITNUMINTL(s, 8, 23) |
      BITNUMINTL(s, 18, 24) |
      BITNUMINTL(s, 12, 25) |
      BITNUMINTL(s, 29, 26) |
      BITNUMINTL(s, 5, 27) |
      BITNUMINTL(s, 21, 28) |
      BITNUMINTL(s, 10, 29) |
      BITNUMINTL(s, 3, 30) |
      BITNUMINTL(s, 24, 31)) >>>
    0

  return s
}

function desCrypt(input: Uint8Array, schedule: Uint8Array[]): Uint8Array {
  let [s0, s1] = IP(input)
  for (let idx = 0; idx < 15; idx++) {
    const t = s1
    s1 = (feistelF(s1, schedule[idx]) ^ s0) >>> 0
    s0 = t
  }
  s0 = (feistelF(s1, schedule[15]) ^ s0) >>> 0
  return invIP(s0, s1)
}

// --- 3DES ---

function tripleDESKeySetup(key: Uint8Array, mode: number): Uint8Array[][] {
  if (mode === ENCRYPT) {
    return [
      keySchedule(key.subarray(0, 8), ENCRYPT),
      keySchedule(key.subarray(8, 16), DECRYPT),
      keySchedule(key.subarray(16, 24), ENCRYPT),
    ]
  }
  return [
    keySchedule(key.subarray(16, 24), DECRYPT),
    keySchedule(key.subarray(8, 16), ENCRYPT),
    keySchedule(key.subarray(0, 8), DECRYPT),
  ]
}

function tripleDESCrypt(input: Uint8Array, schedule: Uint8Array[][]): Uint8Array {
  let out = desCrypt(input, schedule[0])
  out = desCrypt(out, schedule[1])
  out = desCrypt(out, schedule[2])
  return out
}

// --- Public API ---

const QQ_QRC_KEY = Buffer.from('!@#)(*$%123ZXC!@!@#)(NHL', 'ascii')

/**
 * Decrypt QQ Music QRC encrypted lyrics.
 *
 * @param encryptedHex - Hex-encoded encrypted lyric data from musicu GetPlayLyricInfo (qrc=1)
 * @returns Decrypted QRC XML/text, or null on failure
 */
export function decryptQrc(encryptedHex: string): string | null {
  try {
    const encrypted = Buffer.from(encryptedHex, 'hex')
    if (encrypted.length < 8 || encrypted.length % 8 !== 0) return null

    const schedule = tripleDESKeySetup(QQ_QRC_KEY, DECRYPT)
    const decrypted = Buffer.alloc(encrypted.length)
    for (let i = 0; i < encrypted.length; i += 8) {
      const block = tripleDESCrypt(Uint8Array.from(encrypted.subarray(i, i + 8)), schedule)
      decrypted.set(block, i)
    }

    const decompressed = inflateSync(decrypted)
    return decompressed.toString('utf8')
  } catch {
    return null
  }
}

/**
 * Check if a string looks like hex-encoded QRC data.
 */
export function isHexQrc(s: string): boolean {
  if (!s || s.length < 16 || s.length % 2 !== 0) return false
  return /^[0-9A-Fa-f]+$/.test(s)
}
