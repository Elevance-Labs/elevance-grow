import { useCallback, useEffect, useRef, useState } from 'react'

interface Answer<T> {
  data: T | null
  error: { code?: string; message: string } | null
}

/**
 * Loads something for a page and keeps it fresh: `reload()` after a write,
 * and, with `pollMs`, again every so often while that is a number (pages pass
 * one only while a run is going, so an idle page asks for nothing).
 */
export function useLoad<T>(load: () => PromiseLike<Answer<T>>, deps: unknown[], pollMs: number | false = false) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const latest = useRef(load)
  // Kept in an effect, declared before the ones that read it, so a reload
  // always runs the newest query.
  useEffect(() => {
    latest.current = load
  })
  const turn = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++turn.current
    const answer = await latest.current()
    // A slower, older answer must not overwrite a newer one.
    if (mine !== turn.current) return
    setError(answer.error?.message ?? null)
    if (!answer.error) setData(answer.data)
    setLoading(false)
  }, [])

  // Read again when what the page asked for changes (deps are ids and filters).
  const key = JSON.stringify(deps)
  useEffect(() => {
    setLoading(true)
    reload()
  }, [key, reload])

  useEffect(() => {
    if (!pollMs) return
    const timer = window.setInterval(reload, pollMs)
    return () => window.clearInterval(timer)
  }, [pollMs, reload])

  return { data, error, loading, reload }
}

/** How often a page asks again while a run is going. */
export const POLL_MS = 4000
