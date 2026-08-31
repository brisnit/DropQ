-- Auth rate limiting.
--
-- FULLY ADDITIVE. One new table. No existing table is altered, no existing row
-- is read or written, there is no backfill and no destructive statement.
--
-- Locking: CREATE TABLE and CREATE INDEX on a brand-new relation take locks on
-- nothing that is in use. There is no impact on Seller, Customer, Order or any
-- other live table, and no rewrite of anything.
--
-- Rollback: the application can be rolled back WITHOUT touching the database —
-- an older build simply never references this table. Only drop it if the
-- feature is abandoned; dropping it discards in-flight rate-limit windows,
-- which self-heal within an hour anyway.
--
-- Note: `gen_random_uuid()` is used by the limiter's INSERT. It is built in to
-- PostgreSQL 13+ (Neon runs well past that), so no extension is required.

CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "windowAt" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- The counter's identity. This unique constraint is what makes the limiter's
-- INSERT ... ON CONFLICT atomic; without it two concurrent attempts could each
-- insert a row and the count would be lost.
CREATE UNIQUE INDEX "RateLimit_bucket_key_windowAt_key"
    ON "RateLimit"("bucket", "key", "windowAt");

-- Cleanup of closed windows, run from the existing reminders cron.
CREATE INDEX "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");
