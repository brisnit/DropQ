-- Rename the CspReport unique index to the name Prisma derives from the schema.
--
-- WHY THIS EXISTS. The preceding migration created the index as
-- `..._blockedUri_sourc_key` (62 characters) because the name was truncated by
-- hand. Prisma derives `..._blockedUri_source_key` (63 characters, the
-- PostgreSQL identifier limit) from the same @@unique, so `prisma migrate diff`
-- reported a permanent one-line drift for as long as the two disagreed.
--
-- The preceding migration is already applied in production and its file is
-- therefore immutable — an applied migration is history, not a draft. The fix
-- belongs in a new migration, which is what this is.
--
-- SCOPE. One rename. No table is recreated, nothing is dropped, no row is read
-- or written, and no application record changes in any way.
--
-- LOCKING. ALTER INDEX ... RENAME TO takes a brief ACCESS EXCLUSIVE lock on the
-- index. It rewrites no data and is effectively instantaneous; on a table with
-- a handful of rows it is imperceptible. The index remains valid and usable
-- throughout — the constraint it enforces is never dropped, so the
-- deduplication the collector relies on is never absent for even an instant.
--
-- ROLLBACK. Rename it back. Nothing else is affected.

ALTER INDEX "CspReport_documentPath_effectiveDirective_blockedUri_sourc_key"
    RENAME TO "CspReport_documentPath_effectiveDirective_blockedUri_source_key";
