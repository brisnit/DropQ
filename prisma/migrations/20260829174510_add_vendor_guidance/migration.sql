-- Vendor guidance (Phase G.1) — one new table, ZERO alterations to existing
-- tables, no data deleted. Inert on deploy: nothing in the app reads or writes
-- this table yet.
--
-- The backfill at the bottom is the only reason this migration is not purely
-- a CREATE TABLE. It exists to honour one product decision: vendors who
-- existed before guidance shipped must NOT be ambushed by a welcome modal on
-- their next login. They can still take the tour deliberately from Help.

-- CreateTable
CREATE TABLE "VendorGuidance" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "welcomeSeenAt" TIMESTAMP(3),
    "tourStatus" TEXT NOT NULL DEFAULT 'not_started',
    "tourStep" INTEGER NOT NULL DEFAULT 0,
    "tourStartedAt" TIMESTAMP(3),
    "tourEndedAt" TIMESTAMP(3),
    "dismissedCoachmarks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dismissedTips" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sharedAt" TIMESTAMP(3),
    "helpOpenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorGuidance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorGuidance_sellerId_key" ON "VendorGuidance"("sellerId");

-- AddForeignKey
ALTER TABLE "VendorGuidance" ADD CONSTRAINT "VendorGuidance_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every seller that exists at deploy time is marked as having
-- already seen the welcome modal.
--
-- `tourStatus` is deliberately left at 'not_started', NOT 'skipped': these
-- vendors did not skip anything, and "Take the DropQ tour" must still be
-- offered to them in Help. Only the unprompted modal is suppressed.
--
-- The id is derived from the seller id rather than generated, so re-running
-- this statement on a partially-migrated database is a no-op instead of a
-- duplicate-row error. Prisma generates ids client-side (@default(cuid())),
-- so the column carries no database default and any unique text is valid.
INSERT INTO "VendorGuidance" ("id", "sellerId", "welcomeSeenAt", "createdAt", "updatedAt")
SELECT 'gseed_' || "Seller"."id", "Seller"."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Seller"
ON CONFLICT ("sellerId") DO NOTHING;
