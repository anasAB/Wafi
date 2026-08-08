// src/features/notifications/notificationRouting.ts
//
// Deep-link destination mapping (WAFI-145 design spec). The subscriber's only job
// is populating entity_type/entity_id correctly; this table is the ONLY place that
// knows about Vue routes, kept out of the domain/event layer entirely.
//
// This router uses path-based routes with no `name` fields (confirmed against
// src/router/index.ts), so destinations are plain paths, not named-route objects.
// Only shift/customer/product/staff have a real per-record detail route today;
// sale/expense/return/device fall back to their closest list page since no
// per-record detail screen exists for them yet. This is a deliberate, documented
// scope limit (building four new detail screens is out of scope for this ticket),
// not an oversight — revisit if a later ticket adds those detail pages.
import type { RouteLocationRaw } from 'vue-router'

const ROUTES: Record<string, (id: string) => RouteLocationRaw> = {
  shift:    (id) => ({ path: `/shifts/${id}` }),
  customer: (id) => ({ path: `/customers/${id}` }),
  product:  (id) => ({ path: `/products/${id}/edit` }),
  staff:    (id) => ({ path: `/staff/${id}/ledger` }),
  sale:     () => ({ path: '/history' }),
  expense:  () => ({ path: '/expenses' }),
  return:   () => ({ path: '/history' }),
  device:   () => ({ path: '/settings/devices' }),
}

export function resolveNotificationRoute(entityType: string, entityId: string): RouteLocationRaw | null {
  return ROUTES[entityType]?.(entityId) ?? null
}
