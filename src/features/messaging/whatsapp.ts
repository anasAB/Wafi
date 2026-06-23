/** Normalize a phone to wa.me international form (digits only, no '+'). Null if unusable. */
export function resolvePhone(raw: string | null | undefined, countryCode = '963'): string | null {
  if (!raw) return null
  let d = raw.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  else if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0')) d = countryCode + d.slice(1)
  else if (!d.startsWith(countryCode)) d = countryCode + d
  return d.length >= 11 ? d : null   // country code + local (>= ~8 digits)
}

export function buildWaMeUrl(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}

export function openWhatsApp(phone: string, text: string): void {
  window.open(buildWaMeUrl(phone, text), '_blank')
}
