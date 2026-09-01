-- CSP violation reports.
--
-- FULLY ADDITIVE. One new table. No existing table is altered, no existing row
-- is read or written, there is no backfill and no destructive statement.
--
-- Locking: CREATE TABLE and CREATE INDEX on a brand-new relation take locks on
-- nothing that is in use. No impact on Seller, Customer, Order, RateLimit or
-- any other live table.
--
-- Rollback: the application can be rolled back WITHOUT touching the database —
-- an older build simply never references this table. Reporting is advisory, so
-- discarding its contents costs nothing operationally.

CREATE TABLE "CspReport" (
    "id" TEXT NOT NULL,
    "documentPath" TEXT NOT NULL,
    "effectiveDirective" TEXT NOT NULL,
    "blockedUri" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL DEFAULT '',
    "lineNumber" INTEGER NOT NULL DEFAULT 0,
    "columnNumber" INTEGER NOT NULL DEFAULT 0,
    "disposition" TEXT NOT NULL DEFAULT 'report',
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CspReport_pkey" PRIMARY KEY ("id")
);

-- The deduplication key. This unique constraint is what makes the collector's
-- INSERT ... ON CONFLICT atomic; without it a page emitting the same violation
-- on every load would insert a row per page view and the table would grow with
-- traffic rather than with the number of distinct problems.
--
-- Every column is NOT NULL for the same reason: in Postgres a NULL never
-- conflicts with a NULL, so a nullable member would silently defeat dedup.
CREATE UNIQUE INDEX "CspReport_documentPath_effectiveDirective_blockedUri_sourc_key"
    ON "CspReport"("documentPath", "effectiveDirective", "blockedUri", "sourceFile", "lineNumber", "columnNumber");

-- Retention sweep, run from the existing reminders cron.
CREATE INDEX "CspReport_expiresAt_idx" ON "CspReport"("expiresAt");

-- Ordering the report queue by recency when reviewing violations.
CREATE INDEX "CspReport_lastSeenAt_idx" ON "CspReport"("lastSeenAt");
