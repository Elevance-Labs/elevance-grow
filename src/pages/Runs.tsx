import { useEffect, useState } from 'react'
import { Alert } from '@mui/material'
import { RunList, WorkerNotice } from '../components/Agent'
import { PageHeader } from '../components/common'
import { POLL_MS, useLoad } from '../lib/data'
import { anyOpen, loadRuns, type RunWithJobs } from '../lib/runs'

/** Everything the agent was asked to do, newest first, with its steps and token use. */
export default function Runs() {
  const [polling, setPolling] = useState(false)
  const runs = useLoad<RunWithJobs[]>(() => loadRuns(null, 60), [], polling ? POLL_MS : false)
  const open = anyOpen(runs.data)
  useEffect(() => setPolling(open), [open])
  return (
    <>
      <PageHeader title="Runs" subtitle="Every job the agent was given, what it did, and what it used." />
      <WorkerNotice waiting={open} />
      {runs.error && <Alert severity="error">{runs.error}</Alert>}
      {runs.data && <RunList runs={runs.data} onChange={runs.reload} />}
    </>
  )
}
