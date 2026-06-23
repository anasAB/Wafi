/** Normalize a phone to wa.me international form (digits only, no '+'). Null if unusable. */
export function resolvePhone(raw: string | null | undefined, countryCode = '963'): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const isIntl = trimmed.startsWith('+') || trimmed.startsWith('00')
  let d = trimmed.replace(/\D/g, '')          // digits only — drops any stray '+'
  if (isIntl) {
    if (d.startsWith('00')) d = d.slice(2)     // '00' international prefix
    // otherwise already in international digit form
  } else if (d.startsWith('0')) {
    d = countryCode + d.slice(1)               // local leading-zero number
  } else if (!d.startsWith(countryCode)) {
    d = countryCode + d                         // bare local number
  }
  return d.length >= 11 ? d : null
}

export function buildWaMeUrl(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}

export function openWhatsApp(phone: string, text: string): void {
  window.open(buildWaMeUrl(phone, text), '_blank')
}
