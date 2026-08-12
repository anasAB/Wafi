import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@sentry/vue', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

import * as Sentry from '@sentry/vue'
import { reportDeferredJobDead } from '@/services/events/reportDeferredJobDead'

const captureException = Sentry.captureException as any
const captureMessage = Sentry.captureMessage as any

const row = { job_type: 'test.a', shop_id: 'shop1', attempts: 5, last_error: 'boom', payload: '{"secret":"nope"}' }

describe('reportDeferredJobDead', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses captureException with structured context when a live Error is passed', async () => {
    const err = new Error('boom')
    await reportDeferredJobDead(row, err)
    expect(captureException).toHaveBeenCalledWith(err, expect.objectContaining({
      extra: { job_type: 'test.a', shop_id: 'shop1', attempts: 5 },
    }))
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('falls back to captureMessage with row.last_error when no live Error is available', async () => {
    await reportDeferredJobDead(row)
    expect(captureMessage).toHaveBeenCalledWith('boom', expect.objectContaining({
      extra: { job_type: 'test.a', shop_id: 'shop1', attempts: 5 },
    }))
    expect(captureException).not.toHaveBeenCalled()
  })

  it('never includes payload in either call', async () => {
    await reportDeferredJobDead(row, new Error('boom'))
    const call = captureException.mock.calls[0]
    expect(JSON.stringify(call)).not.toContain('secret')
  })

  it('does not throw even if captureException throws', async () => {
    captureException.mockImplementation(() => {
      throw new Error('Sentry SDK network error')
    })
    const err = new Error('job failed')
    // Should resolve without throwing, despite Sentry SDK error
    await expect(reportDeferredJobDead(row, err)).resolves.toBeUndefined()
  })

  it('does not throw even if captureMessage throws', async () => {
    captureMessage.mockImplementation(() => {
      throw new Error('Sentry SDK config error')
    })
    // Should resolve without throwing, despite Sentry SDK error
    await expect(reportDeferredJobDead(row)).resolves.toBeUndefined()
  })
})
