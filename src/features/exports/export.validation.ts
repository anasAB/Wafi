import { LARGE_EXPORT_ROWS } from './export.types'

// Validate a user-entered custom date range. Returns an Arabic error message to
// show, or null when the range is usable. ISO 'YYYY-MM-DD' strings sort
// chronologically under string comparison, so no Date parsing is needed.
export function validateCustomRange(start: string, end: string): string | null {
  if (!start || !end) return 'الرجاء تحديد تاريخ البداية والنهاية'
  if (start > end) return 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية'
  return null
}

// A result big enough that we warn before building the file (see LARGE_EXPORT_ROWS).
export function isLargeExport(rowCount: number): boolean {
  return rowCount > LARGE_EXPORT_ROWS
}
