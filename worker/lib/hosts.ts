// Which hosts and addresses model-chosen requests may reach. Web pages are
// untrusted, so a page can talk the model into asking for an address on the
// worker's own network; these checks are what refuse it.

const PRIVATE_SUFFIX = /\.(local|localhost|internal|intranet|lan|home|corp|test|invalid|example)$/
const PUBLIC_NAME = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/

/** A public DNS name: no addresses, no single-label or private names. Mirrors public.valid_public_host. */
export function validPublicHost(host: unknown): host is string {
  return typeof host === 'string' && PUBLIC_NAME.test(host) && !PRIVATE_SUFFIX.test(host)
}

/** One to five public hosts, lower-cased; or the reason they are refused. */
export function checkHosts(hosts: unknown): { hosts: string[]; error: null } | { hosts: null; error: string } {
  if (!Array.isArray(hosts) || hosts.length < 1 || hosts.length > 5) {
    return { hosts: null, error: 'Name one to five hosts the script calls.' }
  }
  const clean = hosts.map((h) => (typeof h === 'string' ? h.trim().toLowerCase() : h))
  const bad = clean.find((h) => !validPublicHost(h))
  if (bad !== undefined) {
    return { hosts: null, error: `"${String(bad)}" is not a public host name. Give bare names such as "example.org": no addresses, ports, paths or private names.` }
  }
  return { hosts: [...new Set(clean as string[])], error: null }
}

/** Loopback, private, link-local, carrier NAT, multicast and the like: never fetched. */
export function isPrivateAddress(address: string) {
  const ip = address.toLowerCase()
  if (ip.includes(':')) {
    if (ip === '::1' || ip === '::') return true
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    // Unique local fc00::/7, link-local fe80::/10, multicast ff00::/8.
    return /^(fc|fd)/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith('ff')
  }
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}
