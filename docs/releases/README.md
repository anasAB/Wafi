# Release Log

One file per release: `vX.Y.Z.md`. Created as the last step of every
deployment (see `docs/DEPLOYMENT.md`'s "After Deployment" checklist,
item 13). This accumulates over time — the value isn't in any single
entry, it's in being able to answer "which deployment, what changed, how
do we back out" months later without re-deriving it from git log.

## Template

```markdown
# vX.Y.Z — YYYY-MM-DD

**Git SHA:** `abc1234`
**Migrations included (this release):** 068, 069 (or "none — code-only release")

## Changes
- ...

## Breaking changes
- None. (Or: describe, and what a deployer must do about it.)

## Rollback notes
- Application: previous build was vX.Y.(Z-1), SHA `...`
- Database: (state whether any migration in this release is one-way --
  per docs/DEPLOYMENT.md's rollback section, describe the forward-fix
  path if something goes wrong, don't claim a migration can be undone)

## Known issues
- None. (Or: list, so "was this always broken or did we just break it"
  has an answer.)
```
