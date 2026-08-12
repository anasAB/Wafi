export interface JobTypePolicy {
  jobType: string
  handler: (job: { id: string; payload: unknown }) => Promise<void>
  priority: 'critical' | 'normal' | 'low'
  requiresNetwork: boolean
  maxQueuedJobs: number
  evictable: boolean
}

const registry = new Map<string, JobTypePolicy>()

/** Job-type-side registration: owns every operational policy decision for a job type,
 *  exactly once, regardless of how many deferred subscribers eventually enqueue it.
 *  evictable is never a parameter -- always derived from priority (see design spec's
 *  Capacity & Eviction section: `evictable = priority !== 'critical'` structurally,
 *  so the two properties can never disagree). */
export function registerJobHandler(opts: {
  jobType: string
  handler: (job: { id: string; payload: unknown }) => Promise<void>
  priority: 'critical' | 'normal' | 'low'
  requiresNetwork: boolean
  maxQueuedJobs: number
}): void {
  registry.set(opts.jobType, { ...opts, evictable: opts.priority !== 'critical' })
}

export function getJobTypePolicy(jobType: string): JobTypePolicy | undefined {
  return registry.get(jobType)
}

export function getRegisteredJobTypes(): string[] {
  return Array.from(registry.keys())
}

/** Test-only: clears the registry between test files/cases so one test's
 *  registerJobHandler calls never leak into another. */
export function resetJobTypeRegistry(): void {
  registry.clear()
}
