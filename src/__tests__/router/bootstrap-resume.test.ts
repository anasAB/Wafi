import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const resumeMock = vi.fn()
vi.mock('@/features/staff/composables/useOwnerBootstrap', () => ({
  useOwnerBootstrap: () => ({ bootstrapOwner: vi.fn(), resumePendingBootstrap: resumeMock }),
}))

describe('boot-time pending-bootstrap auto-resume', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('does nothing when there is no pending bootstrap', async () => {
    const { resumeBootstrapIfPending } = await import('@/router/bootstrap-resume')
    resumeMock.mockResolvedValue({ status: 'nothing-pending' })

    await resumeBootstrapIfPending()

    expect(resumeMock).toHaveBeenCalled()
  })

  it('resumes automatically without prompting for a PIN when a pending bootstrap exists', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    useBootstrapStore().start('device-1', 'staff-1')
    resumeMock.mockResolvedValue({ status: 'done' })

    const { resumeBootstrapIfPending } = await import('@/router/bootstrap-resume')
    const result = await resumeBootstrapIfPending()

    expect(result).toEqual({ status: 'done' })
  })
})
