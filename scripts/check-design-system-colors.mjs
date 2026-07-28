#!/usr/bin/env node
// WAFI-005 design-system freeze enforcement (rev 1 of the mechanism — see
// docs/architecture/DESIGN_SYSTEM.md §9). Invariant: flag a newly introduced
// color literal in a PR's diff that isn't part of the documented palette.
// This is a deliberately narrow first pass (bare 6-hex-digit literals only —
// no rgb()/hsl()/oklch()/var()/Tailwind-arbitrary detection yet) that only
// scans the diff, never the whole repo, so pre-existing hardcoded colors in
// untouched files never trip it. Non-blocking: informational only (the CI
// workflow marks this step continue-on-error), matching the design doc's
// "flag, not hard-block" requirement.

import { execSync } from 'node:child_process'

// Every color value documented in DESIGN_SYSTEM.md §3 (plus the two known
// "two-shades-in-use" pairs it explicitly records rather than picks a winner
// for) — anything else is treated as a new, undocumented introduction.
const DOCUMENTED_HEX = new Set([
  '#1A56DB', '#1a56db', // brand blue
  '#1248B3', '#1248b3', // brand blue gradient end
  '#06090F', '#06090f', // page background
  '#0D1828', '#0d1828', // card background (legacy dark-glass variant)
  '#E8EDF5', '#e8edf5', // primary text
  '#93A3B8', '#93a3b8', // muted text (variant 1)
  '#637285', '#637285', // muted text (variant 2)
  '#22C55E', '#22c55e', // success
  '#EF4444', '#ef4444', // error (general)
  '#DC2626', '#dc2626', // error (destructive-confirm)
  '#F59E0B', '#f59e0b', // warning (variant 1)
  '#FBBF24', '#fbbf24', // warning (variant 2)
])

const HEX_PATTERN = /#[0-9a-fA-F]{6}\b/g

function getBaseRef() {
  return process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : 'origin/main'
}

function getChangedFiles(baseRef) {
  const out = execSync(`git diff --name-only --diff-filter=ACM ${baseRef}...HEAD`, {
    encoding: 'utf8',
  })
  return out.split('\n').filter(f => /\.(vue|css)$/.test(f))
}

function getAddedLines(baseRef, file) {
  const out = execSync(`git diff ${baseRef}...HEAD -- "${file}"`, { encoding: 'utf8' })
  return out
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
}

function main() {
  const baseRef = getBaseRef()
  let files
  try {
    files = getChangedFiles(baseRef)
  } catch (e) {
    console.error(`Could not diff against ${baseRef}:`, e.message)
    process.exit(0) // never block on a diff-mechanics failure — informational check only
  }

  const findings = []
  for (const file of files) {
    let addedLines
    try {
      addedLines = getAddedLines(baseRef, file)
    } catch {
      continue
    }
    for (const line of addedLines) {
      const matches = line.match(HEX_PATTERN) ?? []
      for (const hex of matches) {
        if (!DOCUMENTED_HEX.has(hex)) {
          findings.push({ file, hex, line: line.slice(1).trim() })
        }
      }
    }
  }

  if (findings.length === 0) {
    console.log('No undocumented color literals found in the diff.')
    return
  }

  console.log('Possible undocumented color(s) introduced in this PR:\n')
  for (const f of findings) {
    console.log(`  ${f.file}: ${f.hex}\n    ${f.line}`)
  }
  console.log(
    '\nIf this is intentional, add it to docs/architecture/DESIGN_SYSTEM.md §3 ' +
    'in this same PR (and to scripts/check-design-system-colors.mjs\'s DOCUMENTED_HEX ' +
    'list) before merging. This check is informational, not a hard block.',
  )
  process.exitCode = 1
}

main()
