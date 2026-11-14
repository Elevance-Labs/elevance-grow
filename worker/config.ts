// The worker's settings: worker/.env beside this file, or the environment.
import { readFileSync } from 'node:fs'

export interface Config {
  url: string
  anonKey: string
  email: string
  password: string
  claudeBin: string
  denoBin: string
  modelResearch: string
  modelWriting: string
  jobTimeoutMs: number
  pollMs: number
  /** An extra tool server for pages that need a real browser, as JSON; off when empty. */
  browserServer: { command: string; args?: string[] } | null
}

function fileValues(): Record<string, string> {
  let text: string
  try {
    text = readFileSync(new URL('./.env', import.meta.url), 'utf8')
  } catch {
    return {}
  }
  const values: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !line.trim().startsWith('#')) values[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2')
  }
  return values
}

export function loadConfig(env: Record<string, string | undefined> = process.env, file = fileValues()): Config {
  const get = (key: string) => (env[key] ?? file[key] ?? '').trim()
  const need = (key: string) => {
    const value = get(key)
    if (!value) throw new Error(`${key} is not set. Copy worker/.env.example to worker/.env and fill it in.`)
    return value
  }
  const email = need('GROW_AGENT_EMAIL').toLowerCase()
  let browserServer: Config['browserServer'] = null
  if (get('GROW_BROWSER_SERVER')) {
    try {
      browserServer = JSON.parse(get('GROW_BROWSER_SERVER')) as Config['browserServer']
    } catch {
      throw new Error('GROW_BROWSER_SERVER must be JSON like {"command":"npx","args":["-y","@playwright/mcp@<version>"]}.')
    }
  }
  return {
    url: need('GROW_SUPABASE_URL'),
    anonKey: need('GROW_SUPABASE_ANON_KEY'),
    email,
    password: need('GROW_AGENT_PASSWORD'),
    claudeBin: get('GROW_CLAUDE_BIN') || 'claude',
    denoBin: get('GROW_DENO_BIN') || 'deno',
    modelResearch: get('GROW_MODEL_RESEARCH') || 'sonnet',
    modelWriting: get('GROW_MODEL_WRITING') || 'opus',
    jobTimeoutMs: (Number(get('GROW_JOB_TIMEOUT_MINUTES')) || 25) * 60_000,
    pollMs: (Number(get('GROW_POLL_SECONDS')) || 5) * 1000,
    browserServer,
  }
}
