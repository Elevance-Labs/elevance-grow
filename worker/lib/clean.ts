// Cleaning what a collector returns: plain code, the same result every time.
// No model is involved in turning a source's rows into candidates.

export interface CandidateRow {
  name: string
  city?: string
  state?: string
  website?: string
  phone?: string
  address?: string
  country?: string
  source_url?: string
  raw?: string
}

const LEGAL_FORMS = /\b(inc|incorporated|llc|co|corp|corporation|company|ltd|limited|the)\b/g
const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * What makes two rows the same business: the name without its legal form or
 * punctuation, with the city and state. Mirrors public.account_key in the
 * database, which is what finally refuses a duplicate.
 */
export function accountKey(name: string, city?: string | null, state?: string | null) {
  const bare = name.toLowerCase().replaceAll('.', '').replace(LEGAL_FORMS, '')
  return `${squash(bare)}|${squash(city ?? '')}|${squash(state ?? '')}`
}

const text = (value: unknown, max: number) => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const clean = String(value).replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, max) : undefined
}

/** An http(s) address, or nothing: a link is never made from anything else. */
export function httpUrl(value: unknown) {
  const raw = text(value, 2000)
  if (!raw) return undefined
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.hostname.includes('.') ? url.href : undefined
  } catch {
    return undefined
  }
}

export interface Cleaned {
  rows: CandidateRow[]
  /** Rows left out: not an object, no usable name, or a repeat within the batch. */
  dropped: number
  duplicates: number
}

/** Rows as the database takes them: trimmed, capped, one per business. */
export function cleanRows(input: unknown, limit = 5000): Cleaned {
  if (!Array.isArray(input)) throw new Error('A collector returns an array of rows.')
  const seen = new Set<string>()
  const rows: CandidateRow[] = []
  let dropped = 0
  let duplicates = 0
  for (const item of input.slice(0, limit)) {
    const name = item && typeof item === 'object' ? text((item as Record<string, unknown>).name, 200) : undefined
    if (!name || !squash(name)) {
      dropped++
      continue
    }
    const r = item as Record<string, unknown>
    const row: CandidateRow = {
      name,
      city: text(r.city, 120),
      state: text(r.state, 120),
      website: httpUrl(r.website),
      phone: text(r.phone, 60),
      address: text(r.address, 300),
      country: text(r.country, 120),
      source_url: httpUrl(r.source_url),
      raw: text(r.raw, 2000),
    }
    const key = accountKey(row.name, row.city, row.state)
    if (seen.has(key)) {
      duplicates++
      continue
    }
    seen.add(key)
    rows.push(row)
  }
  dropped += Math.max(0, input.length - limit)
  return { rows, dropped, duplicates }
}
