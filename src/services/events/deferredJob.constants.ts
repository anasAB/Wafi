export const DEFERRED_JOB_LEASE_MINUTES = 5
export const MAX_ATTEMPTS = 5
export const DEFAULT_MAX_QUEUED_JOBS_PER_TYPE = 200
export const GLOBAL_QUEUE_CEILING = 1000
export const RETENTION_DAYS = 7
export const BACKOFF_MINUTES = [1, 5, 30, 120] as const // must match eventProcessingRetryQueue.ts's BACKOFF_MINUTES exactly
