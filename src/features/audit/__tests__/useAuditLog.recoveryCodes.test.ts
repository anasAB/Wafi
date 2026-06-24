import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { db } from '@/data/powersync/db'

describe('useAuditLog recovery-code events (WAFI-057)', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any) })

  it('logRecoveryCodeUsed writes a sensitive audit row naming the owner', async () => {
    const { logRecoveryCodeUsed } = useAuditLog()
    await logRecoveryCodeUsed('owner-1', 'أحمد')
    const call = vi.mocked(db.execute).mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO audit_log'))
    expect(call).toBeTruthy()
    expect(call![1]).toEqual(expect.arrayContaining(['staff.recovery_code_used', 'staff', 'owner-1']))
    expect(JSON.parse(call![1]![7] as string)).toMatchObject({ name: 'أحمد' })
  })
})
