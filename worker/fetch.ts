// The worker's own reading of a page, for the quote check. The address comes
// from the model, which read it on the open web, so nothing private may be
// reachable through it: public host names only, every address they resolve to
// checked, and each redirect checked again.
import { lookup } from 'node:dns/promises'
import { isPrivateAddress, validPublicHost } from './lib/hosts.ts'
import { htmlToText } from './lib/verify.ts'
import type { PageRead } from './tools.ts'

const TIMEOUT_MS = 20_000
const MAX_BYTES = 3_000_000
const MAX_REDIRECTS = 5
// A plain browser-like name: says nothing about who is asking.
const USER_AGENT = 'Mozilla/5.0 (compatible; page-check/1.0)'

async function allowed(url: URL): Promise<string | null> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'not a web address'
  if (url.username || url.password) return 'addresses with a login in them are not opened'
  if (url.port && url.port !== '80' && url.port !== '443') return 'only the standard web ports are opened'
  const host = url.hostname.toLowerCase()
  if (!validPublicHost(host)) return 'not a public host name'
  try {
    const addresses = await lookup(host, { all: true })
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) return 'that name does not lead to a public address'
  } catch {
    return 'that host name does not exist'
  }
  return null
}

async function body(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  await reader.cancel().catch(() => undefined)
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks).subarray(0, MAX_BYTES))
}

/** The page's visible text, or why it could not be read. */
export async function readPage(address: string): Promise<PageRead> {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return { ok: false, reason: 'not a web address' }
  }
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const refused = await allowed(url)
      if (refused) return { ok: false, reason: refused }
      const response = await fetch(url, {
        redirect: 'manual',
        signal,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
      })
      const next = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null
      if (next) {
        await response.body?.cancel().catch(() => undefined)
        url = new URL(next, url)
        continue
      }
      const type = (response.headers.get('content-type') ?? '').toLowerCase()
      if (type && !/text\/|json|xml/.test(type)) {
        await response.body?.cancel().catch(() => undefined)
        return { ok: false, reason: `it is a ${type.split(';')[0]} file, which the checker does not read` }
      }
      const raw = await body(response)
      return { ok: true, status: response.status, text: /html|xml/.test(type) || /^\s*</.test(raw) ? htmlToText(raw) : raw.replace(/\s+/g, ' ').trim() }
    }
    return { ok: false, reason: 'too many redirects' }
  } catch (e) {
    return { ok: false, reason: signal.aborted ? 'the site took too long to answer' : `the request failed (${(e as Error).message})` }
  }
}
