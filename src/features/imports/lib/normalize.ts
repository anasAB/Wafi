/** Trim to string; nullish/non-string → ''. */
export function normalizeText(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  return String(raw).trim()
}

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩'

/** Parse a possibly-messy cell into a finite number, or null. */
export function normalizeNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  let s = normalizeText(raw)
  if (s === '') return null
  // Arabic-Indic digits → ASCII
  s = s.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
  // keep only digits, dot, minus
  s = s.replace(/[^0-9.\-]/g, '')
  if (s === '' || s === '-' || s === '.') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
