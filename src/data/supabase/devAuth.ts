import { supabase } from './client'
import { db } from '@/data/powersync/db'
import { SupabaseConnector } from '@/data/powersync/connector'

function envFlag(name: string): boolean {
  const raw = (import.meta.env[name] as string | undefined)?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

export async function bootstrapDevAuth(): Promise<void> {
  if (import.meta.env.PROD) return
  if (!envFlag('VITE_DEV_AUTO_SIGNIN')) return

  const email = (import.meta.env.VITE_DEV_SUPABASE_EMAIL as string | undefined)?.trim()
  const password = (import.meta.env.VITE_DEV_SUPABASE_PASSWORD as string | undefined)?.trim()

  if (!email || !password) {
    console.warn('[DevAuth] VITE_DEV_AUTO_SIGNIN is enabled but credentials are missing.')
    return
  }

  const existing = await supabase.auth.getSession()
  if (existing.error) {
    console.warn('[DevAuth] Could not read current session:', existing.error.message)
  }

  if (!existing.data.session) {
    const signedIn = await supabase.auth.signInWithPassword({ email, password })
    if (signedIn.error) {
      console.warn('[DevAuth] Auto sign-in failed:', signedIn.error.message)
      return
    }
  }

  if (import.meta.env.VITE_POWERSYNC_URL) {
    await db.connect(new SupabaseConnector()).catch((err: Error) => {
      console.warn('[DevAuth] Signed in but PowerSync connect failed:', err.message)
    })
  }
}
