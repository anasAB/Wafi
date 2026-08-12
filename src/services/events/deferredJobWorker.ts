import { db } from '@/data/powersync/db'
import { initLocalDeferredJobsSchema } from '@/services/events/deferredJobsSchema'
import { drainDeferredJobs } from '@/services/events/drainDeferredJobs'

/**
 * WAFI-154 worker triggers: app foreground/visibility and PowerSync reconnect, no
 * polling timer (design spec's Worker Triggers section). Zero real job types are
 * registered by this ticket, so in production this currently drains an always-empty
 * queue until a future ticket calls registerJobHandler for a real job type -- that is
 * expected, not a bug (see design spec's Out of Scope).
 */
export function startDeferredJobWorker(shopId: string): { stop: () => void } {
  void initLocalDeferredJobsSchema(db)

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void drainDeferredJobs(shopId)
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  void drainDeferredJobs(shopId) // also attempt once at startup, matching startNotificationSubscribers/startAuditSubscribers's mount-time pattern

  const unsubscribe = db.registerListener?.({
    statusChanged: (status: { connected: boolean }) => {
      if (status.connected) void drainDeferredJobs(shopId)
    },
  })

  return {
    stop: () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      unsubscribe?.()
    },
  }
}
