import { pathToFileURL } from 'node:url'

export type Projection = 'daily_event_counts' | 'profit_cache'

export interface ScopedRebuildArgs {
  projection: Projection
  mode: 'scoped'
  shopId: string
  from?: string
  to?: string
}
export interface AllRebuildArgs {
  projection: Projection
  mode: 'all'
}
export type ParsedArgs = ScopedRebuildArgs | AllRebuildArgs

const KNOWN_PROJECTIONS = ['daily_event_counts', 'profit_cache'] as const

export function parseArgs(argv: string[]): ParsedArgs {
  const [projection, ...rest] = argv
  if (!KNOWN_PROJECTIONS.includes(projection as any)) {
    throw new Error(`unknown projection: ${projection}. Known projections: ${KNOWN_PROJECTIONS.join(', ')}`)
  }

  const flags = new Map<string, string | true>()
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (token === '--all') { flags.set('all', true); continue }
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const value = rest[i + 1]
      flags.set(key, value)
      i++
    }
  }

  const isAll = flags.get('all') === true
  const shopId = flags.get('shop') as string | undefined
  const projectionName = projection as Projection

  if (isAll && shopId) {
    throw new Error('cannot combine --shop and --all -- pick one scope mode explicitly')
  }
  if (isAll) {
    return { projection: projectionName, mode: 'all' }
  }

  const from = flags.get('from') as string | undefined
  const to = flags.get('to') as string | undefined
  if (!shopId) {
    throw new Error('--shop is required for a scoped rebuild (or pass --all for a full rebuild)')
  }
  if (projectionName === 'profit_cache') {
    if (from || to) {
      throw new Error('profit_cache does not support --from/--to: rebuild is always full-shop-scope')
    }
    return { projection: projectionName, mode: 'scoped', shopId }
  }
  if (!from || !to) {
    throw new Error('--from and --to are both required for a scoped rebuild')
  }
  return { projection: projectionName, mode: 'scoped', shopId, from, to }
}

export interface RebuildDeps {
  rebuildScope: (shopId: string, from?: string, to?: string) => Promise<{ rows_deleted: number; events_replayed: number }>
  listShopIds: () => Promise<string[]>
}

export interface ShopRebuildResult {
  shopId: string
  status: 'success' | 'failed'
  rowsDeleted?: number
  eventsReplayed?: number
  error?: string
}

// --all rebuilds each shop's full history ('0001-01-01' to '9999-12-31' --
// Postgres DATE's actual min/max range) as its own call, so a failure on one
// shop cannot roll back or block shops already completed. This is a batch of
// independently-transactional per-shop rebuilds, never one global transaction
// (see design spec) -- each rebuildScope() call is already one transaction
// server-side (Task 2); this loop just doesn't wrap them in anything shared.
export async function runRebuild(args: ParsedArgs, deps: RebuildDeps): Promise<ShopRebuildResult[]> {
  if (args.mode === 'scoped') {
    const result = await deps.rebuildScope(args.shopId, args.from, args.to)
    return [{ shopId: args.shopId, status: 'success', rowsDeleted: result.rows_deleted, eventsReplayed: result.events_replayed }]
  }

  const shopIds = await deps.listShopIds()
  const results: ShopRebuildResult[] = []
  for (const shopId of shopIds) {
    try {
      const result = await deps.rebuildScope(shopId, '0001-01-01', '9999-12-31')
      results.push({ shopId, status: 'success', rowsDeleted: result.rows_deleted, eventsReplayed: result.events_replayed })
    } catch (err) {
      results.push({ shopId, status: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }
  return results
}

// Real entrypoint -- not covered by the unit tests above (they inject fakes
// for RebuildDeps); this wires a real service-role Supabase client. Requires
// a SUPABASE_SERVICE_ROLE_KEY env var (never the anon key used elsewhere in
// this app -- rebuild_daily_event_counts_scope is service_role-only, see
// Task 2's design note on why this function has no per-caller shop check).
async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to run this CLI.')
    process.exit(1)
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const args = parseArgs(process.argv.slice(2))
  const deps: RebuildDeps = {
    rebuildScope: async (shopId, from, to) => {
      if (args.projection === 'profit_cache') {
        const { data, error } = await supabase.rpc('rebuild_profit_cache_scope', { p_shop_id: shopId })
        if (error) throw new Error(error.message)
        return data as { rows_deleted: number; events_replayed: number }
      }
      const { data, error } = await supabase.rpc('rebuild_daily_event_counts_scope', { p_shop_id: shopId, p_from: from, p_to: to })
      if (error) throw new Error(error.message)
      return data as { rows_deleted: number; events_replayed: number }
    },
    listShopIds: async () => {
      const { data, error } = await supabase.from('shops').select('id')
      if (error) throw new Error(error.message)
      return (data ?? []).map((row: { id: string }) => row.id)
    },
  }

  const results = await runRebuild(args, deps)
  for (const result of results) {
    if (result.status === 'success') {
      console.log(`${result.shopId}: OK -- ${result.rowsDeleted} rows deleted, ${result.eventsReplayed} events replayed`)
    } else {
      console.error(`${result.shopId}: FAILED -- ${result.error}`)
    }
  }
  const anyFailed = results.some((r) => r.status === 'failed')
  process.exit(anyFailed ? 1 : 0)
}

// Run main if this file is executed directly. Compared via pathToFileURL
// (not a raw `file://${process.argv[1]}` template) because on Windows
// process.argv[1] is a drive-letter path (C:\...) while import.meta.url is a
// proper file:// URL (file:///C:/...) -- the naive template never matches on
// win32, so main() silently never runs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
}
