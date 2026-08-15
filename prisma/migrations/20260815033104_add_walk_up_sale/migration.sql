-- CreateTable
CREATE TABLE "WalkUpSale" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "dropId" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "orderId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalkUpSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalkUpSale_token_key" ON "WalkUpSale"("token");

-- CreateIndex
CREATE UNIQUE INDEX "WalkUpSale_orderId_key" ON "WalkUpSale"("orderId");

-- CreateIndex
CREATE INDEX "WalkUpSale_sellerId_idx" ON "WalkUpSale"("sellerId");

-- CreateIndex
CREATE INDEX "WalkUpSale_expiresAt_idx" ON "WalkUpSale"("expiresAt");

-- AddForeignKey
ALTER TABLE "WalkUpSale" ADD CONSTRAINT "WalkUpSale_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkUpSale" ADD CONSTRAINT "WalkUpSale_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "Drop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkUpSale" ADD CONSTRAINT "WalkUpSale_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

