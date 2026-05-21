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
    await fn({ execute: vi.fn().mockResolvedValue({}) })
  }),
  getAll: vi.fn().mockResolvedValue([]),
  getOptional: vi.fn().mockResolvedValue(null),
  get: vi.fn().mockResolvedValue({}),
  connect: vi.fn(),
  status: {
    connected: false,
    dataFlowStatus: { downloading: false, uploading: false },
  },
}
