-- Phase A: analytics foundation.
--
-- FULLY ADDITIVE. One new table, eight new nullable columns across two existing
-- tables. No column is dropped, renamed, retyped or defaulted-with-a-value; no
-- existing row is read or written by this migration; there is no backfill.
--
-- Locking: `ADD COLUMN ... NULL` with no default is a catalogue-only change in
-- PostgreSQL 11+. It takes a brief ACCESS EXCLUSIVE lock to update the catalogue
-- and does NOT rewrite the table. On Seller (8 rows) and Customer (24 rows) this
-- is sub-millisecond regardless.
--
-- Rollback: the application is safe to roll back WITHOUT touching the database —
-- older builds simply never reference the new table or columns, exactly as the
-- VendorGuidance rollback works. Only drop these objects if abandoning the
-- feature outright, and note that dropping the table destroys collected events.

-- 1. Anonymous acquisition on the vendor, alongside the existing sales-rep
--    attribution. All NULL until a vendor signs up with analytics enabled.
ALTER TABLE "Seller" ADD COLUMN "firstTouchVisitorId" TEXT;
ALTER TABLE "Seller" ADD COLUMN "firstTouchAt" TIMESTAMP(3);
ALTER TABLE "Seller" ADD COLUMN "signupSource" TEXT;
ALTER TABLE "Seller" ADD COLUMN "signupSourceDetail" TEXT;
ALTER TABLE "Seller" ADD COLUMN "signupCampaign" TEXT;
ALTER TABLE "Seller" ADD COLUMN "lastTouchSource" TEXT;
ALTER TABLE "Seller" ADD COLUMN "lastTouchCampaign" TEXT;

-- 2. Customer-side internal classification, mirroring Seller.internalKind.
--    Deliberately left NULL for every existing row: NULL means "real external
--    demand", which is the correct default, and guessing a classification from
--    a name or a purchase pattern would silently mislabel a real customer.
--    Known internal customers are classified by hand afterwards.
ALTER TABLE "Customer" ADD COLUMN "internalKind" TEXT;

-- 3. The events table. Append-only; no foreign keys by design, so that a write
--    never waits on a referential check and an event outlives the row it names.
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sellerId" TEXT,
    "customerId" TEXT,
    "dropId" TEXT,
    "path" TEXT NOT NULL,
    "referrerDomain" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "device" TEXT NOT NULL DEFAULT 'unknown',
    "env" TEXT NOT NULL,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "props" JSONB,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- Five indexes, one per planned query. Nothing speculative:
--   funnel counts and time series    → (name, at)
--   one visitor's pre-signup journey → (visitorId, at)
--   one sitting's timeline           → (sessionId, at)
--   everything a converted vendor did→ (sellerId, at)
--   campaign performance             → (utmCampaign, at)
-- Source/medium/path are read from rows already narrowed by name + window, so
-- they get no index of their own.
CREATE INDEX "AnalyticsEvent_name_at_idx" ON "AnalyticsEvent"("name", "at");
CREATE INDEX "AnalyticsEvent_visitorId_at_idx" ON "AnalyticsEvent"("visitorId", "at");
CREATE INDEX "AnalyticsEvent_sessionId_at_idx" ON "AnalyticsEvent"("sessionId", "at");
CREATE INDEX "AnalyticsEvent_sellerId_at_idx" ON "AnalyticsEvent"("sellerId", "at");
CREATE INDEX "AnalyticsEvent_utmCampaign_at_idx" ON "AnalyticsEvent"("utmCampaign", "at");
