import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SupplierForm from '@/features/suppliers/components/SupplierForm.vue'

describe('SupplierForm', () => {
  it('disables submit when name is empty', () => {
    const wrapper = mount(SupplierForm)
    const btn = wrapper.find('[data-test="submit"]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('emits submit with the entered fields', async () => {
    const wrapper = mount(SupplierForm)
    await wrapper.find('[data-test="name"]').setValue('مؤسسة النور')
    await wrapper.find('[data-test="phone"]').setValue('0999')
    await wrapper.find('[data-test="submit"]').trigger('click')
    expect(wrapper.emitted('submit')?.[0][0]).toMatchObject({
      name: 'مؤسسة النور', phone: '0999',
    })
  })

  it('prefills fields from the initial prop', () => {
    const wrapper = mount(SupplierForm, {
      props: { initial: { name: 'النور', address: 'دمشق' } },
    })
    expect((wrapper.find('[data-test="name"]').element as HTMLInputElement).value).toBe('النور')
    expect((wrapper.find('[data-test="address"]').element as HTMLInputElement).value).toBe('دمشق')
  })
})
