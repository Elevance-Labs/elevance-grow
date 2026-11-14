// Starts Claude Code for one job and reads back how it went. Claude Code is
// signed in on this computer with its owner's Claude account; the worker
// never sees those credentials. The prompt goes in on standard input, so
// nothing from the web or the database is ever part of a command line.
import { spawn } from 'node:child_process'

export interface ClaudeRun {
  ok: boolean
  /** Claude's closing message. */
  text: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  /** The account's usage limit was reached: not a failure of the job. */
  limit: boolean
  /** Claude Code is not signed in on this computer. */
  signedOut: boolean
  error: string | null
}

export interface ClaudeOptions {
  bin: string
  model: string
  mcpConfig: string
  builtins: string[]
  /** Every tool Claude may call without being asked; anything else is refused. */
  allowed: string[]
  cwd: string
  timeoutMs: number
  onSpawn?: (kill: () => void) => void
}

/** Claude Code's arguments. No prompt here: it is piped in. */
export function claudeArgs(o: Pick<ClaudeOptions, 'model' | 'mcpConfig' | 'builtins' | 'allowed'>) {
  return [
    '--print',
    '--output-format', 'json',
    '--model', o.model,
    // Only the job's own tool server: none of the owner's connectors or plugins.
    '--mcp-config', o.mcpConfig, '--strict-mcp-config',
    // The built-in tools that exist at all for this job ("" is none): never the shell or files.
    '--tools', o.builtins.join(','),
    '--allowedTools', o.allowed.join(','),
    '--disable-slash-commands',
    '--no-session-persistence',
  ]
}

const LIMIT = /usage limit|limit reached|limit will reset|out of (extra )?usage|rate[ _-]?limit|overloaded|too many requests/i
const SIGNED_OUT = /not logged in|please run \/login|\/login|invalid api key|authentication_error|oauth token (has )?expired/i

interface ResultMessage {
  type?: string
  subtype?: string
  is_error?: boolean
  result?: string
  total_cost_usd?: number
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
}

/** Reads `--output-format json`: one result object (or a list of messages ending in one). */
export function parseResult(stdout: string, stderr: string, code: number | null): ClaudeRun {
  let message: ResultMessage | null = null
  try {
    const parsed: unknown = JSON.parse(stdout.trim())
    const list = Array.isArray(parsed) ? parsed : [parsed]
    message = (list.filter((m) => m && typeof m === 'object' && (m as ResultMessage).type === 'result').at(-1) as ResultMessage | undefined) ?? null
  } catch {
    // Not JSON: it failed before producing a result. Fall through with what it printed.
  }
  const said = message?.result ?? ''
  const noise = `${said}\n${message ? '' : stdout}\n${stderr}`
  const failed = !message || message.is_error === true || (message.subtype !== undefined && message.subtype !== 'success') || code !== 0
  const usage = message?.usage ?? {}
  return {
    ok: !failed,
    text: said.trim(),
    tokensIn: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    tokensOut: usage.output_tokens ?? 0,
    costUsd: message?.total_cost_usd ?? 0,
    limit: failed && LIMIT.test(noise),
    signedOut: failed && SIGNED_OUT.test(noise),
    error: failed
      ? (said || stderr.trim().split('\n').slice(-6).join('\n') || stdout.trim().slice(-600) || `Claude Code ended with code ${code}.`).slice(0, 1500)
      : null,
  }
}

// On Windows the command may be a .cmd shim, which needs the shell; then each
// argument is quoted by hand. No argument carries anything but fixed words,
// tool names and a temp path.
const quote = (arg: string) => (arg === '' || /[\s"&|<>^%*]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg)

export function runClaude(prompt: string, o: ClaudeOptions): Promise<ClaudeRun> {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32'
    const args = claudeArgs(o)
    const child = spawn(shell ? quote(o.bin) : o.bin, shell ? args.map(quote) : args, {
      cwd: o.cwd,
      shell,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (run: ClaudeRun) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(run)
    }
    const kill = () => {
      child.kill()
      setTimeout(() => child.kill('SIGKILL'), 5000).unref()
    }
    const timer = setTimeout(() => {
      kill()
      finish({ ...parseResult('', '', 1), error: `Stopped after ${Math.round(o.timeoutMs / 60000)} minutes without finishing.` })
    }, o.timeoutMs)
    o.onSpawn?.(kill)
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-20_000) })
    child.on('error', (e: NodeJS.ErrnoException) =>
      finish({ ...parseResult('', '', 1), signedOut: false, error: e.code === 'ENOENT' ? `Claude Code was not found ("${o.bin}"). Install it on this computer and sign in; see the README.` : e.message }))
    child.on('close', (code) => finish(parseResult(stdout, stderr, code)))
    child.stdin.on('error', () => undefined)
    child.stdin.end(prompt)
  })
}

/** "2.1.3" from `claude --version`, or null when it is not installed. */
export function version(bin: string, flag = '--version'): Promise<string | null> {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32'
    const child = spawn(shell ? quote(bin) : bin, [flag], { shell, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString() })
    child.on('error', () => resolve(null))
    child.on('close', (code) => resolve(code === 0 ? (out.match(/\d+\.\d+\.\d+/)?.[0] ?? out.trim().slice(0, 40)) : null))
  })
}
