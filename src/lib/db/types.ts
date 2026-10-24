export type JobKind =
  | 'skill_run'
  | 'detector_run'
  | 'coverage_scan'
  | 'press_clip'
  | 'coverage_reel'
  | 'chat_research'

export type JobStatus =
  | 'queued'
  | 'running'
  | 'waiting_manus'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ClientRow = {
  id: string
  org_id: string
  slug: string
  name: string
  standing: string
  beats: string
  competitors: string
  spokespeople: string
  proof_assets: string
  notes: string
  created_at: string
  updated_at: string
}

export type MonitorRow = {
  id: string
  org_id: string
  client_id: string
  slug: string
  title: string
  topics: string[]
  feeds: string[]
  schedule_cron: string
  enabled: boolean
  last_run_at: string | null
  created_at: string
}

export type JobRow = {
  id: string
  org_id: string
  client_id: string | null
  monitor_id: string | null
  kind: JobKind
  skill_slug: string | null
  status: JobStatus
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  output_text: string | null
  error: string | null
  manus_task_id: string | null
  manus_task_url: string | null
  manus_event_log: unknown[]
  created_at: string
  updated_at: string
  completed_at: string | null
}

export type ArtifactRow = {
  id: string
  org_id: string
  job_id: string | null
  kind: string
  storage_path: string | null
  external_url: string | null
  mime_type: string | null
  meta: Record<string, unknown>
  created_at: string
}
