/**
 * Fold Arabic text for search so a query typed without diacritics matches stored
 * text that has them, and common letter variants are treated as equal (WAFI-018).
 * Syrian shop owners type fast and without harakat, so search must be lenient.
 *
 * Apply to BOTH the stored value and the query before comparing.
 */
export function normalizeArabic(s: string): string {
  return (s ?? '')
    .replace(/[ً-ْٰ]/g, '') // harakat / tashkeel (+ superscript alef)
    .replace(/ـ/g, '')                // tatweel (kashida)
    .replace(/[آأإ]/g, 'ا') // آ أ إ → ا
    .replace(/ى/g, 'ي')          // alef-maksura ى → ي
    .replace(/ة/g, 'ه')          // taa-marbuta ة → ه
    .toLowerCase()
    .trim()
}

/** True when `query` matches `haystack` under Arabic-insensitive folding. */
export function matchesArabicQuery(haystack: string, query: string): boolean {
  const q = normalizeArabic(query)
  if (!q) return true
  return normalizeArabic(haystack).includes(q)
}
