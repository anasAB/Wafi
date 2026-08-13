import { describe, it, expect } from 'vitest'
import { FIXTURES } from './eventContractFixtures'

describe.each(Object.entries(FIXTURES))('event contract: %s', (_type, fixture) => {
  it('matches its committed shape snapshot', () => {
    expect(fixture).toMatchSnapshot()
  })
})
