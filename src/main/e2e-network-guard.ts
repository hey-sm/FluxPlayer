import http from 'node:http'
import https from 'node:https'

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' ||
    normalized.startsWith('127.') || normalized.startsWith('::ffff:127.')
}

function hostnameFromRequest(input: string | URL | http.RequestOptions): string {
  if (typeof input === 'string' || input instanceof URL) return new URL(input).hostname
  const host = String(input.hostname || input.host || '')
  return host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
}

function blocked(hostname: string): never {
  const error = new Error(`E2E_NETWORK_BLOCKED: non-loopback request to ${hostname || '<unknown>'}`)
  console.error('[E2E_NETWORK_BLOCKED]', error.message)
  throw error
}

function guardRequest<T extends typeof http.request>(request: T): T {
  return function guardedRequest(this: unknown, input: string | URL | http.RequestOptions, ...args: unknown[]) {
    const hostname = hostnameFromRequest(input)
    if (!isLoopback(hostname)) blocked(hostname)
    return Reflect.apply(request, this, [input, ...args])
  } as T
}

if (process.env.FLUX_E2E === '1') {
  http.request = guardRequest(http.request)
  http.get = function guardedGet(input: string | URL | http.RequestOptions, ...args: unknown[]) {
    const request = Reflect.apply(http.request, http, [input, ...args]) as http.ClientRequest
    request.end()
    return request
  } as typeof http.get
  https.request = guardRequest(https.request)
  https.get = function guardedGet(input: string | URL | https.RequestOptions, ...args: unknown[]) {
    const request = Reflect.apply(https.request, https, [input, ...args]) as http.ClientRequest
    request.end()
    return request
  } as typeof https.get

  const nativeFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? new URL(input.url) : new URL(String(input))
    if (!isLoopback(url.hostname)) blocked(url.hostname)
    return nativeFetch(input, init)
  }
}
