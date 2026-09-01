# Migration safety

## The rule

**Never validate a migration with a command that resolves `DATABASE_URL` on its
own.** That includes `prisma migrate deploy`, `prisma migrate dev`, and
`prisma db push`.

Validate with `prisma migrate diff --from-migrations`, which takes
`--shadow-database-url` explicitly and never reads the datasource url:

```
node scripts/verify-migrations.mjs
```

That script replays every migration in `prisma/migrations` into a throwaway
PostgreSQL cluster, compares the result to `schema.prisma`, and requires an
empty diff. It cannot reach production, by construction.

To actually apply a migration to production, go through the guard:

```
CONFIRM_PRODUCTION_MIGRATION=1 node scripts/db-guard.mjs migrate deploy
```

## What happened, 31 August 2026

While verifying `20260901000000_add_csp_report` against a throwaway cluster,
`prisma migrate deploy` was run with `DATABASE_URL` set in the process
environment to the throwaway database.

**The Prisma CLI loaded `.env` in preference to the environment variable it was
given, and applied the migration to production** at 23:37:08Z.

Blast radius was small — the migration is additive, so it created one empty
table and touched no existing row (sellers 7, customers 11, drops 10, orders 10,
all unchanged before and after), and no application code referencing the table
was deployed. But nothing about the command made it *likely* to be small. The
same mistake on a migration with an `ALTER` or a backfill would have been a real
incident during business hours.

Two things made it possible:

1. **This repository's `.env` points at production.** That is the root cause,
   and it is the same root cause that produced the fixture leak documented in
   `lib/fixture-guard.ts`. Any Prisma command run without care is one flag away
   from the live database.
2. **`prisma migrate deploy` needs no confirmation and prints no target
   warning** beyond a host name in its banner, which is easy to skim past when
   the command is expected to be a no-op against a scratch database.

### The second finding

Because the migration ran against a real PostgreSQL, it also surfaced a defect
that the intended verification would have caught anyway: the unique index name
in the migration had been hand-truncated to `..._blockedUri_sourc_key`, while
Prisma derives `..._blockedUri_source_key` (63 characters, the PostgreSQL
identifier limit). `migrate diff` reported the drift as a one-line rename.

### How it was resolved

Production history was preserved exactly. Nothing was dropped, no
`_prisma_migrations` row was edited, and no migration was marked rolled back.

- `20260901000000_add_csp_report/migration.sql` was restored byte-for-byte to
  what production executed. Its SHA-256 matches the `checksum` column recorded
  in `_prisma_migrations`, so Prisma reports no modification.
- The correction ships as a separate migration,
  `20260901001000_fix_csp_report_index_name`, containing one `ALTER INDEX …
  RENAME TO …`.

**An applied migration file is immutable.** It is a record of what a database
actually executed, not a draft. Corrections go in a new migration, always.

## A third thing worth knowing

`npx prisma` in a directory outside this repo resolves a *different* Prisma than
the project's. On 31 Aug that was a newer CLI in which `migrate` had been
renamed to `migration`. When scripting against Prisma, invoke
`node_modules/.bin/prisma` explicitly rather than trusting `npx` to find the
pinned version.

## The guard — `scripts/db-guard.mjs`

Implemented. It refuses any mutating Prisma command against the production Neon
host unless `CONFIRM_PRODUCTION_MIGRATION=1` is set.

```
node scripts/db-guard.mjs                     # what would this target?
node scripts/db-guard.mjs migrate status      # read-only, runs freely
node scripts/db-guard.mjs migrate deploy      # REFUSED
CONFIRM_PRODUCTION_MIGRATION=1 \
  node scripts/db-guard.mjs migrate deploy    # allowed, and says so
```

Four properties that matter, each asserted in the `security-headers` self-test:

- **It resolves the URL the way Prisma does.** It reads the process environment
  *and* `.env`, and treats either one matching production as production. Had it
  only checked the environment, it would have approved the exact command that
  caused this incident.
- **It fails closed.** No URL, an unparseable URL, a host it cannot determine —
  all refuse. A guard that lets you through when it is confused is not a guard.
- **It never prints the URL.** Only a hostname is ever shown; no credential is
  logged, interpolated, or held anywhere it could be.
- **It uses `node_modules/.bin/prisma`**, never `npx`.

Mutating subcommands covered: `migrate deploy`, `migrate dev`, `migrate reset`,
`migrate resolve`, `db push`, `db seed`, `db execute`. Read-only commands such
as `migrate status` pass through untouched.

Note that in this repository the guard reports **production for every command**,
because `.env` points there. That is not a false positive — it is an accurate
description of the current setup, and the reason the next item matters.

## Still to do — the real fix

**Move the production URL out of `.env`.** Point the repo's `.env` at a local
database and keep production in `.env.production`, reached only through an
explicit `--env-file=.env.production`. This removes the whole class of mistake
rather than one instance of it, and it would have prevented the fixture leak
recorded in `lib/fixture-guard.ts` as well. It touches every `db:*` script in
`package.json`, so it deserves a deliberate pass rather than a quick edit.

A third, smaller measure worth adding at the same time: a self-test asserting
that `package.json` contains no script invoking `migrate deploy`, `migrate dev`
or `db push` without an explicit `--env-file`, so a convenient-but-unsafe
shortcut cannot be added quietly later.
