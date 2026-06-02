import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import CustomerForm from '@/features/customers/components/CustomerForm.vue'
import { db } from '@/data/powersync/db'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

function mountForm(props = {}) {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return mount(CustomerForm, {
    props,
    global: { plugins: [pinia, router] },
  })
}

describe('CustomerForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('shows name required error when saving with empty name', async () => {
    const w = mountForm()
    await w.find('[data-testid="save-btn"]').trigger('click')
    expect(w.find('[data-testid="error-name"]').exists()).toBe(true)
  })

  it('emits saved after valid form submission', async () => {
    const w = mountForm()
    await w.find('[data-testid="name-input"]').setValue('أبو خالد')
    await w.find('[data-testid="save-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))
    expect(w.emitted('saved')).toBeTruthy()
  })

  it('emits cancel when cancel button clicked', async () => {
    const w = mountForm()
    await w.find('[data-testid="cancel-btn"]').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })

  it('pre-fills fields when initial prop is provided', async () => {
    const initial = { id: 'c1', shopId: 's1', name: 'أبو خالد', phone: '099',
                      mobile: '098', address: 'المزة', deleted: false,
                      createdAt: '', syncStatus: '' }
    const w = mountForm({ initial })
    expect((w.find('[data-testid="name-input"]').element as HTMLInputElement).value).toBe('أبو خالد')
    expect((w.find('[data-testid="phone-input"]').element as HTMLInputElement).value).toBe('099')
  })

  it('calls UPDATE when initial prop is provided (edit mode)', async () => {
    const initial = { id: 'c1', shopId: 's1', name: 'أبو خالد', phone: '',
                      mobile: '', address: '', deleted: false, createdAt: '', syncStatus: '' }
    const w = mountForm({ initial })
    await w.find('[data-testid="name-input"]').setValue('أبو محمد')
    await w.find('[data-testid="save-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE customers'),
      expect.any(Array)
    )
  })
})
