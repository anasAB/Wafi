import { describe, it, expect } from 'vitest'
import { BUILD_INFO } from '@/version'

describe('BUILD_INFO', () => {
  it('exposes non-empty version, gitSha, buildDate, and a positive migrationNumber', () => {
    expect(typeof BUILD_INFO.version).toBe('string')
    expect(BUILD_INFO.version.length).toBeGreaterThan(0)

    expect(typeof BUILD_INFO.gitSha).toBe('string')
    expect(BUILD_INFO.gitSha.length).toBeGreaterThan(0)

    expect(typeof BUILD_INFO.buildDate).toBe('string')
    expect(BUILD_INFO.buildDate.length).toBeGreaterThan(0)

    expect(typeof BUILD_INFO.migrationNumber).toBe('number')
    expect(BUILD_INFO.migrationNumber).toBeGreaterThan(0)
  })
})
