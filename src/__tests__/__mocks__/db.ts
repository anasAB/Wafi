import { vi } from 'vitest'

export const db = {
  execute: vi.fn().mockResolvedValue({ rows: { _array: [] } }),
  watch: vi.fn().mockReturnValue(new (class { subscribe = vi.fn() })),
  writeTransaction: vi.fn().mockImplementation(async (fn: (tx: any) => Promise<void>) => {
    await fn({ execute: vi.fn().mockResolvedValue({}) })
  }),
  connect: vi.fn(),
  status: {
    connected: false,
    dataFlowStatus: { downloading: false, uploading: false },
  },
}
