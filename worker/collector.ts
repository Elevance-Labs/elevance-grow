// Runs a collector: model-written code, so it runs in a sandbox. Deno gives
// it the network for its declared hosts and nothing else: no files, no
// environment, no other programs, no code fetched from elsewhere.
import { spawn } from 'node:child_process'
import { mkdtemp, copyFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkHosts } from './lib/hosts.ts'
import type { CollectorRun } from './tools.ts'

const START = '<<<GROW_ROWS>>>'
const END = '<<<GROW_END>>>'
const MAX_OUTPUT = 40_000_000

const RUNNER = `import collect from './collector.ts'
const rows = await collect()
console.log(${JSON.stringify('\n' + START)} + JSON.stringify(rows ?? null) + ${JSON.stringify(END)})
`

/** Deno's arguments for a sandboxed run. Every permission not named here is denied. */
export function denoArgs(hosts: string[], runner: string) {
  return [
    'run',
    '--no-prompt', // a permission that is not granted is refused, never asked for
    '--no-config', '--no-lock',
    '--no-remote', '--no-npm', // only the local files: no code from the network
    `--allow-net=${hosts.join(',')}`,
    runner,
  ]
}

/** The rows printed between the markers, or why there are none. */
export function parseOutput(stdout: string, stderr: string, code: number | null): CollectorRun {
  const start = stdout.lastIndexOf(START)
  const end = stdout.lastIndexOf(END)
  if (start >= 0 && end > start) {
    try {
      const rows: unknown = JSON.parse(stdout.slice(start + START.length, end))
      return Array.isArray(rows) ? { ok: true, rows } : { ok: false, error: 'The script must return an array of rows.' }
    } catch {
      return { ok: false, error: 'The script returned something that is not JSON.' }
    }
  }
  // Deno is run with NO_COLOR, so its messages are plain text.
  const message = stderr.trim().split('\n').slice(-12).join('\n')
  return { ok: false, error: message || `The script ended (code ${code}) without returning rows.` }
}

export interface CollectorOptions {
  deno: string
  timeoutMs?: number
}

export async function runCollector(code: string, hosts: string[], options: CollectorOptions): Promise<CollectorRun> {
  // Checked again here, at the point of use, whatever the caller checked.
  const checked = checkHosts(hosts)
  if (checked.error !== null) return { ok: false, error: checked.error }
  const dir = await mkdtemp(join(tmpdir(), 'grow-collector-'))
  try {
    await writeFile(join(dir, 'collector.ts'), code)
    await writeFile(join(dir, 'runner.ts'), RUNNER)
    await copyFile(new URL('./sandbox/helpers.ts', import.meta.url), join(dir, 'helpers.ts'))
    return await new Promise<CollectorRun>((resolve) => {
      const child = spawn(options.deno, denoArgs(checked.hosts, join(dir, 'runner.ts')), {
        cwd: dir,
        // Nothing of the worker's environment (its login, its keys) is passed on.
        env: { PATH: process.env.PATH ?? '', NO_COLOR: '1', DENO_NO_UPDATE_CHECK: '1', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let stdout = ''
      let stderr = ''
      let done = false
      const finish = (result: CollectorRun) => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish({ ok: false, error: 'The script ran too long and was stopped.' })
      }, options.timeoutMs ?? 180_000)
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
        if (stdout.length > MAX_OUTPUT) {
          child.kill('SIGKILL')
          finish({ ok: false, error: 'The script printed too much and was stopped.' })
        }
      })
      child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-20_000) })
      child.on('error', (e: NodeJS.ErrnoException) =>
        finish({ ok: false, error: e.code === 'ENOENT' ? 'Deno is not installed on the worker. It is what runs collectors safely; see the README.' : e.message }))
      child.on('close', (exit) => finish(parseOutput(stdout, stderr, exit)))
    })
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
