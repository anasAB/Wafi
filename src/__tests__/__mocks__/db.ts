import { vi } from 'vitest'

export const db = {
  execute: vi.fn().mockResolvedValue({ rows: { _array: [] } }),
  watch: vi.fn().mockReturnValue({
    [Symbol.asyncIterator]: vi.fn().mockReturnValue({
      next: vi.fn().mockResolvedValue({ value: { rows: { _array: [], length: 0 } }, done: false }),
      return: vi.fn().mockResolvedValue({ value: undefined, done: true }),
    }),
  }),
  writeTransaction: vi.fn().mockImplementation(async (fn: (tx: any) => Promise<void>) => {
    await fn({ execute: vi.fn().mockResolvedValue({ rows: { _array: [] } }) })
  }),
  getUploadQueueStats: vi.fn().mockResolvedValue({ count: 0, size: 0 }),
  getAll: vi.fn().mockResolvedValue([]),
  getOptional: vi.fn().mockResolvedValue(null),
  get: vi.fn().mockResolvedValue({}),
  connect: vi.fn(),
  disconnectAndClear: vi.fn(),
  status: {
    connected: false,
    dataFlowStatus: { downloading: false, uploading: false },
  },
}

// Mirrors db.ts's reconnectPowerSync(): calls db.connect() and swallows any
// rejection, same as the real implementation, so tests that mock
// db.connect to reject (simulating an offline/racing reconnect) still see
// resumePendingBootstrap/bootstrapOwner fall through to the poll path.
export const reconnectPowerSync = vi.fn().mockImplementation(async () => {
  try {
    await db.connect()
  } catch {
    // swallow, matching real reconnectPowerSync semantics
  }
})
