// The tool server Claude Code starts for a job (see main.ts, which writes its
// settings). It speaks MCP on standard input and output, and offers only the
// tools that job's kind has. It signs in to nothing itself: the worker hands
// it a short-lived token for the worker's own narrow login.
import { readFileSync, writeFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createClient } from '@supabase/supabase-js'
import { runCollector } from './collector.ts'
import { readPage } from './fetch.ts'
import type { JobContext } from './prompts.ts'
import { newStats, toolsFor } from './tools.ts'

const need = (key: string) => {
  const value = process.env[key]
  if (!value) throw new Error(`${key} is not set: this server is started by the worker, not by hand.`)
  return value
}

const ctx = JSON.parse(readFileSync(need('GROW_JOB_FILE'), 'utf8')) as JobContext
const stateFile = need('GROW_STATE_FILE')
const client = createClient(need('GROW_SUPABASE_URL'), need('GROW_SUPABASE_ANON_KEY'), {
  global: { headers: { Authorization: `Bearer ${need('GROW_ACCESS_TOKEN')}` } },
  auth: { persistSession: false, autoRefreshToken: false },
})

const stats = newStats()
const tools = toolsFor({
  jobId: ctx.job.id,
  kind: ctx.job.kind,
  input: ctx.job.input,
  knownFacts: ctx.account?.facts.length ?? 0,
  rpc: async (name, args) => {
    const { data, error } = await client.rpc(name, args)
    return { data, error: error ? { message: error.message, code: error.code } : null }
  },
  readPage,
  runCollector: (code, hosts) => runCollector(code, hosts, { deno: process.env.GROW_DENO_BIN || 'deno' }),
  stats,
  persist: () => writeFileSync(stateFile, JSON.stringify(stats)),
})

const server = new McpServer({ name: 'grow', version: '1.0.0' })
for (const tool of tools) {
  server.tool(tool.name, tool.description, tool.shape, async (args) => {
    try {
      const result = await tool.run(args as Record<string, unknown>)
      return { content: [{ type: 'text' as const, text: result.text }], isError: result.isError }
    } catch (e) {
      return { content: [{ type: 'text' as const, text: `The tool failed: ${(e as Error).message}` }], isError: true }
    }
  })
}
await server.connect(new StdioServerTransport())
