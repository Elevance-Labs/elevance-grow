// What a collector may import (as "./helpers.ts"). It runs under Deno with
// network access to the collector's declared hosts only, so these use web
// standard APIs and nothing else. A collector is:
//
//   import { getText, tableRows } from './helpers.ts'
//   export default async function collect() {
//     const html = await getText('https://example.org/list')
//     return tableRows(html).slice(1).map((cells) => ({
//       name: cells[0], city: cells[1], state: 'OH',
//       source_url: 'https://example.org/list', raw: cells.join(' | '),
//     }))
//   }
//
// Each row: name (required), and whatever of city, state, website, phone,
// address, country the source gives; source_url (the page the row is on) and
// raw (the row's text as the source has it).

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let last = 0
/** One request at a time, at least a second apart: a collector is a polite reader. */
async function polite(url: string, accept: string) {
  const wait = last + 1000 - Date.now()
  if (wait > 0) await sleep(wait)
  last = Date.now()
  const response = await fetch(url, { headers: { accept, 'user-agent': 'Mozilla/5.0 (compatible; list-reader/1.0)' } })
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`)
  return response
}

export const getText = async (url: string) => (await polite(url, 'text/html,text/plain,text/csv,*/*;q=0.5')).text()
export const getJson = async (url: string) => (await polite(url, 'application/json')).json()

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
/** The visible text of a piece of HTML. */
export function textOf(html: string) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
      if (body[0] === '#') {
        const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' '
      }
      return ENTITIES[body.toLowerCase()] ?? whole
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/** Every table row in the HTML, as the text of its cells. */
export function tableRows(html: string) {
  const rows: string[][] = []
  for (const row of html.match(/<tr\b[\s\S]*?<\/tr\s*>/gi) ?? []) {
    const cells = (row.match(/<t[dh]\b[\s\S]*?<\/t[dh]\s*>/gi) ?? []).map(textOf)
    if (cells.length) rows.push(cells)
  }
  return rows
}

/** Every link in the HTML: its text and its absolute address. */
export function links(html: string, base: string) {
  const out: { text: string; url: string }[] = []
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    try {
      out.push({ text: textOf(m[5]), url: new URL(m[2] ?? m[3] ?? m[4], base).href })
    } catch {
      // Not an address: skip it.
    }
  }
  return out
}

/** CSV text as rows of cells (quoted cells, doubled quotes and line breaks inside quotes handled). */
export function parseCsv(text: string, delimiter = ',') {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((c) => c !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c !== '')) rows.push(row)
  return rows
}

/** Rows of cells as objects keyed by the header row. */
export function withHeaders(rows: string[][]) {
  const [head, ...rest] = rows
  if (!head) return []
  const keys = head.map((h) => h.trim().toLowerCase())
  return rest.map((cells) => Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? '').trim()])))
}
