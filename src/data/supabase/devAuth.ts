import { supabase } from './client'
import { db } from '@/data/powersync/db'
import { SupabaseConnector } from '@/data/powersync/connector'

function envFlag(name: string): boolean {
  const raw = (import.meta.env[name] as string | undefined)?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function isInvalidCredentials(message: string): boolean {
  const m = message.toLowerCase()
  return m.includes('invalid login credentials') || m.includes('invalid credentials')
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
      const autoSignup = envFlag('VITE_DEV_AUTO_SIGNUP')

      if (autoSignup && isInvalidCredentials(signedIn.error.message)) {
        const signedUp = await supabase.auth.signUp({ email, password })
        if (signedUp.error) {
          // Supabase may return "User already registered" here. In that case the
          // most likely issue is wrong password for an existing account.
          console.warn('[DevAuth] Auto signup failed:', signedUp.error.message)
          return
        }

        if (!signedUp.data.session) {
          console.warn('[DevAuth] Signup succeeded but no session returned. Check email confirmation settings in Supabase Auth.')
          return
        }
      } else {
        console.warn('[DevAuth] Auto sign-in failed:', signedIn.error.message)
        return
      }
    }
  }

  if (import.meta.env.VITE_POWERSYNC_URL) {
    await db.connect(new SupabaseConnector()).catch((err: Error) => {
      console.warn('[DevAuth] Signed in but PowerSync connect failed:', err.message)
    })
  }
}
