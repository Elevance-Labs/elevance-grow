// The quote check: plain code decides whether the words the model quoted are
// really on the page. The model does not mark its own work.

/** A quote shorter than this proves nothing ("2014" is on most pages). */
export const MIN_QUOTE = 10
/** Fewer characters of text than this and the page was not really read (a script-only shell, a block page). */
export const MIN_PAGE_TEXT = 200

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•',
}

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' '
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

/** The words a reader would see: no scripts, styles, tags or comments. */
export function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/** Differences a copy-paste makes that are not differences in the words. */
function soften(text: string) {
  return text
    .normalize('NFKC')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[­​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export type QuoteCheck =
  | { found: true; context: string }
  | { found: false; reason: 'too_short' | 'not_on_page' }

/**
 * Whether `quote` is on the page, ignoring case, spacing and typographic
 * quotes and dashes; and if so the page's words around it, kept as evidence.
 */
export function findQuote(pageText: string, quote: string, around = 240): QuoteCheck {
  const page = soften(pageText)
  const wanted = soften(quote)
  if (wanted.length < MIN_QUOTE) return { found: false, reason: 'too_short' }
  const at = page.toLowerCase().indexOf(wanted.toLowerCase())
  if (at < 0) return { found: false, reason: 'not_on_page' }
  const start = Math.max(0, at - around)
  const end = Math.min(page.length, at + wanted.length + around)
  return { found: true, context: `${start > 0 ? '… ' : ''}${page.slice(start, end)}${end < page.length ? ' …' : ''}` }
}

/** Signs that what came back is a bot check or a login wall, not the page. */
export function looksBlocked(status: number, text: string) {
  if (status === 401 || status === 403 || status === 429 || status === 503) return true
  const head = text.slice(0, 1500).toLowerCase()
  return /verify (that )?you are (a )?human|are you a robot|captcha|checking your browser|just a moment\.\.\.|access denied|unusual traffic|enable javascript and cookies/.test(head)
}
