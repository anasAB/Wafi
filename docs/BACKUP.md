# Backup & Recovery

## Current backup configuration

**Supabase project tier:** Free

**Backup frequency:** None. Confirmed directly against the production
project's Database → Backups dashboard (2026-07-23): "Free Plan does not
include project backups." The dashboard's general description of
scheduled daily backups ("Projects are backed up daily around midnight of
your project's region") applies to Pro-tier and above — it does not apply
to this project on its current Free plan.

**This means: there is currently no backup of the production database at
all.** This is the honest, confirmed state, not an assumption — see the
context this task was built around
(`docs/superpowers/specs/2026-07-23-wafi-022-deployment-checklist-design.md`):
the important question is "can I restore," and today the honest answer is
no, because there is nothing to restore from.

## Restore procedure

Not applicable today — there is no backup to restore from on the current
Free plan. If the project is upgraded to a tier that includes backups
(Supabase's dashboard states Pro includes up to 7 days of scheduled
backups, plus Point-in-Time Recovery as a separate capability), this
section must be rewritten with the actual, concrete restore steps for
whatever tier is active at that time — including whether restore happens
via the dashboard's "Restore to new project" flow or another mechanism,
and how long a restore takes in practice.

## Last verified restore date

**Not applicable.** No restore has been tested because no backup exists
to test against. This field cannot have a real date until the project has
both a backup capability and an actual test restore has been performed —
do not fill this field with today's date or any other date; that would
misrepresent an untested/nonexistent capability as verified.

## When to use this (Emergency Recovery)

See `docs/DEPLOYMENT.md`'s "Rollback — Three Distinct Situations" section.
Emergency recovery is the last-resort path for actual data loss or
corruption — not for "a migration had a bug" (that's a forward migration,
documented there, not a restore). **Given the current state above, this
path does not currently exist for this project** — a data-loss event today
has no recovery path other than whatever data can be reconstructed from
client-side offline caches (PowerSync/local SQLite) still on individual
devices, which is not a substitute for a real backup.
