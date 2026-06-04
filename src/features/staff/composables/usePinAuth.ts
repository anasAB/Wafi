export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(pin)
  const buffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  return (await hashPin(pin)) === storedHash
}
