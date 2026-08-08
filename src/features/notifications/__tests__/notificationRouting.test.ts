import { describe, it, expect } from 'vitest'
import { resolveNotificationRoute } from '../notificationRouting'

describe('resolveNotificationRoute', () => {
  it('resolves entity types with a real per-record detail route to that record', () => {
    expect(resolveNotificationRoute('shift', 'sh1')).toEqual({ path: '/shifts/sh1' })
    expect(resolveNotificationRoute('customer', 'c1')).toEqual({ path: '/customers/c1' })
    expect(resolveNotificationRoute('product', 'p1')).toEqual({ path: '/products/p1/edit' })
    expect(resolveNotificationRoute('staff', 'st1')).toEqual({ path: '/staff/st1/ledger' })
  })

  it('resolves entity types with no per-record detail page to their closest list page', () => {
    expect(resolveNotificationRoute('sale', 's1')).toEqual({ path: '/history' })
    expect(resolveNotificationRoute('expense', 'e1')).toEqual({ path: '/expenses' })
    expect(resolveNotificationRoute('return', 'r1')).toEqual({ path: '/history' })
    expect(resolveNotificationRoute('device', 'd1')).toEqual({ path: '/settings/devices' })
  })

  it('returns null for an unmapped entity_type rather than throwing', () => {
    expect(resolveNotificationRoute('unknown', 'x')).toBeNull()
  })
})
