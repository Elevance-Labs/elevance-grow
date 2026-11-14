// Accounts: small helpers the pages share.
import type { ChipProps } from '@mui/material'
import type { Account, AccountFact, Contact } from './types'

/** "Dayton, OH" from whatever of the place is known. */
export const placeOf = (a: Pick<Account, 'city' | 'state'>) => [a.city, a.state].filter(Boolean).join(', ')

export function scoreColor(score: number | null): ChipProps['color'] {
  if (score === null) return 'default'
  if (score >= 70) return 'success'
  if (score >= 40) return 'warning'
  return 'default'
}

/**
 * A LinkedIn people search for this person at this business, for a person to
 * open and look at themselves. The app never reads LinkedIn.
 */
export function linkedinSearchUrl(contact: Pick<Contact, 'full_name'>, account: Pick<Account, 'name'>) {
  const keywords = `${contact.full_name} ${account.name}`.trim()
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`
}

/** A link is only ever made from an http(s) address; anything else is shown as text. */
export function safeUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/** The facts still standing, verified first. */
export function standing(facts: AccountFact[]) {
  return facts
    .filter((f) => !f.rejected_at)
    .sort((a, b) => Number(b.verified) - Number(a.verified) || a.created_at.localeCompare(b.created_at))
}

export function factCounts(facts: AccountFact[]) {
  const live = facts.filter((f) => !f.rejected_at)
  return {
    verified: live.filter((f) => f.kind === 'observed' && f.verified).length,
    unverified: live.filter((f) => f.kind === 'observed' && !f.verified).length,
    inferred: live.filter((f) => f.kind === 'inferred').length,
    rejected: facts.length - live.length,
  }
}

/** Waiting on a person: researched, still in "researching". */
export const awaitsDecision = (a: Account) =>
  a.review === 'accepted' && a.stage === 'researching' && a.enriched_at !== null

/** Contacted or talking, with nothing on the timeline for this many days. */
export const QUIET_DAYS = 7
export function goneQuiet(a: Account, now = Date.now()) {
  if (a.review !== 'accepted' || !['contacted', 'talking', 'proposal'].includes(a.stage)) return false
  const last = new Date(a.last_activity_at ?? a.stage_changed_at).getTime()
  return now - last > QUIET_DAYS * 86_400_000
}
