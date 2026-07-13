export type DjBeatmapErrorCode =
  | 'DJ_INVALID_INPUT'
  | 'DJ_UPSTREAM_TIMEOUT'
  | 'DJ_UPSTREAM_TOO_LARGE'
  | 'DJ_UPSTREAM_FAILED'
  | 'DJ_ANALYZER_UNAVAILABLE'
  | 'DJ_ANALYSIS_FAILED'

interface DjBeatmapErrorOptions {
  status: number
  publicMessage?: string
  retryable?: boolean
  cause?: unknown
}

/** Error contract consumed by both the analyzer and the legacy-compatible route. */
export class DjBeatmapError extends Error {
  readonly fallback = true
  readonly status: number
  readonly code: DjBeatmapErrorCode
  readonly publicMessage: string
  readonly retryable: boolean

  constructor(code: DjBeatmapErrorCode, options: DjBeatmapErrorOptions) {
    super(options.publicMessage || code, { cause: options.cause })
    this.name = 'DjBeatmapError'
    this.code = code
    this.status = options.status
    this.publicMessage = options.publicMessage || code
    this.retryable = options.retryable ?? false
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`.toLowerCase()
  return String(error || '').toLowerCase()
}

export function normalizeDjBeatmapError(error: unknown): DjBeatmapError {
  if (error instanceof DjBeatmapError) return error

  const text = errorText(error)
  if (
    (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    /aborterror|timeouterror|timed?\s*out|timeout/.test(text)
  ) {
    return new DjBeatmapError('DJ_UPSTREAM_TIMEOUT', {
      status: 504,
      retryable: true,
      cause: error,
    })
  }
  if (/err_module_not_found|cannot find (package|module)|decoder.+(missing|unavailable)|ffmpeg.+not found/.test(text)) {
    return new DjBeatmapError('DJ_ANALYZER_UNAVAILABLE', {
      status: 503,
      publicMessage: 'DJ_ANALYZER_UNAVAILABLE',
      cause: error,
    })
  }
  if (/audio fetch failed|fetch failed|upstream|response has no body|http\s+\d{3}/.test(text)) {
    return new DjBeatmapError('DJ_UPSTREAM_FAILED', {
      status: 502,
      retryable: true,
      cause: error,
    })
  }
  return new DjBeatmapError('DJ_ANALYSIS_FAILED', {
    status: 500,
    cause: error,
  })
}

export function analyzerUnavailable(cause?: unknown): DjBeatmapError {
  return new DjBeatmapError('DJ_ANALYZER_UNAVAILABLE', {
    status: 503,
    publicMessage: 'DJ_ANALYZER_UNAVAILABLE',
    cause,
  })
}
