export type UnknownRecord = Record<string, unknown>

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function field(value: unknown, key: string): unknown {
  return asRecord(value)[key]
}

export function at(value: unknown, ...path: string[]): unknown {
  let current = value
  for (const key of path) current = field(current, key)
  return current
}

export function stringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return fallback
}

export function optionalString(value: unknown): string | undefined {
  const result = stringValue(value).trim()
  return result || undefined
}

export function numberValue(value: unknown, fallback = 0): number {
  const result = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(result) ? result : fallback
}

export function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true'
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return stringValue(error, 'UNKNOWN_ERROR')
}

export function identifier(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const result = stringValue(value).trim()
  return result || undefined
}
