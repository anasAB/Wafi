import { vi } from 'vitest'

export const db = {
  execute: vi.fn().mockResolvedValue({ rows: { _array: [] } }),
  watch: vi.fn().mockReturnValue({
    [Symbol.asyncIterator]: vi.fn().mockReturnValue({
      next: vi.fn().mockResolvedValue({ value: { rows: { _array: [], length: 0 } }, done: false }),
      return: vi.fn().mockResolvedValue({ value: undefined, done: true }),
    }),
  }),
  // Delegates tx.execute to db.execute by default, so calls made inside a
  // writeTransaction still show up on the db.execute mock for assertions --
  // callers that need transaction-local behavior different from db.execute
  // override this per-test with mockImplementationOnce (see sales.service.test.ts,
  // inventory.service.test.ts).
  writeTransaction: vi.fn().mockImplementation(async (fn: (tx: any) => Promise<void>) => {
    return await fn({ execute: (...args: unknown[]) => (db.execute as any)(...args) })
  }),
  getUploadQueueStats: vi.fn().mockResolvedValue({ count: 0, size: 0 }),
  getAll: vi.fn().mockResolvedValue([]),
  getOptional: vi.fn().mockResolvedValue(null),
  get: vi.fn().mockResolvedValue({}),
  connect: vi.fn(),
  disconnectAndClear: vi.fn(),
  waitForFirstSync: vi.fn().mockResolvedValue(undefined),
  registerListener: vi.fn().mockReturnValue(() => {}),
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
