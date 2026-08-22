/**
 * Audio URL probe: verifies an upstream playback URL actually returns audio
 * bytes before the player commits to it. QQ Music occasionally returns a
 * non-empty `purl` that resolves to an HTML error page or empty response
 * (copyright blocks, expired vkey, CDN hiccups). A 8 KB Range request +
 * magic-byte sniff catches those without downloading the whole track.
 */

export const AUDIO_URL_PROBE_BYTES = 8192

export interface AudioProbeResult {
  ok: boolean
  status: number
  bytes: number
  contentType: string
  magic: string
  reason?: string
}

export interface AudioProbeOptions {
  timeoutMs?: number
  headers?: Record<string, string>
}

export function audioProbeMagic(buffer: Uint8Array): string {
  if (!buffer || buffer.length === 0) return ''
  const ascii = (start: number, len: number) =>
    Buffer.from(buffer.subarray(start, start + len)).toString('ascii')

  if (buffer.length >= 3 && ascii(0, 3) === 'ID3') return 'mp3-id3'
  if (buffer.length >= 4 && ascii(0, 4) === 'fLaC') return 'flac'
  if (buffer.length >= 4 && ascii(0, 4) === 'OggS') return 'ogg'
  if (buffer.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'wave'
  if (buffer.length >= 12 && ascii(4, 4) === 'ftyp') return 'mp4'
  const scanLen = Math.min(buffer.length - 1, 2048)
  for (let i = 0; i < scanLen; i += 1) {
    if (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0) return 'mpeg-frame'
  }
  return ''
}

export async function probePlaybackAudioUrl(
  audioUrl: string,
  options: AudioProbeOptions = {},
): Promise<AudioProbeResult> {
  const timeoutMs = Math.max(300, options.timeoutMs ?? 2500)
  const range = 'bytes=0-' + (AUDIO_URL_PROBE_BYTES - 1)
  try {
    const response = await fetch(audioUrl, {
      method: 'GET',
      headers: { Range: range, ...(options.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    })
    const status = response.status
    const contentType = String(response.headers.get('content-type') || '').toLowerCase()

    if (status !== 200 && status !== 206) {
      try {
        await response.body?.cancel()
      } catch {
        /* ignore */
      }
      return { ok: false, status, bytes: 0, contentType, magic: '', reason: 'status' }
    }

    const reader = response.body?.getReader()
    if (!reader) {
      return { ok: false, status, bytes: 0, contentType, magic: '', reason: 'no-body' }
    }

    const chunks: Uint8Array[] = []
    let total = 0
    const deadline = Date.now() + timeoutMs
    try {
      while (total < AUDIO_URL_PROBE_BYTES && Date.now() < deadline) {
        const chunk = await reader.read()
        if (chunk.done) break
        const buf = chunk.value
        if (!buf || buf.length === 0) continue
        chunks.push(buf)
        total += buf.length
      }
    } finally {
      try {
        await reader.cancel()
      } catch {
        /* ignore */
      }
    }

    const sample = chunks.length
      ? concatBytes(chunks, Math.min(total, AUDIO_URL_PROBE_BYTES))
      : new Uint8Array(0)
    const magic = audioProbeMagic(sample)
    const looksText = /text\/html|application\/(?:json|xml)|text\/plain/.test(contentType)
    return {
      ok: sample.length >= 512 && !looksText && Boolean(magic),
      status,
      bytes: sample.length,
      contentType,
      magic,
      reason:
        sample.length < 512 ? 'too-short' : looksText ? 'text-body' : magic ? undefined : 'unknown-magic',
    }
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network'
    return { ok: false, status: 0, bytes: 0, contentType: '', magic: '', reason }
  }
}

function concatBytes(chunks: Uint8Array[], maxLen: number): Uint8Array {
  const out = new Uint8Array(maxLen)
  let offset = 0
  for (const chunk of chunks) {
    const remaining = maxLen - offset
    if (remaining <= 0) break
    const slice = chunk.subarray(0, Math.min(chunk.length, remaining))
    out.set(slice, offset)
    offset += slice.length
  }
  return out.subarray(0, offset)
}
