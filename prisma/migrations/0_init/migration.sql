-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."Broadcast" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "dropId" TEXT,
    "audience" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClaimRequest" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "locationId" TEXT,
    "marketId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "organization" TEXT,
    "message" TEXT,
    "claimantSellerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CommissionLedger" (
    "id" TEXT NOT NULL,
    "salesRepId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "grossOrderAmount" INTEGER NOT NULL,
    "vendorTakeAmount" INTEGER NOT NULL,
    "dropqFeeAmount" INTEGER,
    "commissionBaseAmount" INTEGER NOT NULL,
    "commissionRate" DOUBLE PRECISION NOT NULL,
    "commissionAmount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),

    CONSTRAINT "CommissionLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Conversation" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "lastDropId" TEXT,
    "lastOrderId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessagePreview" TEXT,
    "lastMessageSender" TEXT,
    "vendorUnread" INTEGER NOT NULL DEFAULT 0,
    "customerUnread" INTEGER NOT NULL DEFAULT 0,
    "vendorLastReadAt" TIMESTAMP(3),
    "customerLastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Customer" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "firstDropId" TEXT,
    "firstPurchaseAt" TIMESTAMP(3),
    "firstTouchAt" TIMESTAMP(3),
    "firstVendorId" TEXT,
    "signupSource" TEXT,
    "signupSourceDetail" TEXT,
    "stripeCustomerId" TEXT,
    "smsConsentDisclosureVersion" TEXT,
    "smsMarketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "smsMarketingConsentAt" TIMESTAMP(3),
    "smsMarketingConsentSource" TEXT,
    "smsOptOutSource" TEXT,
    "smsOptedOutAt" TIMESTAMP(3),
    "smsTransactionalConsent" BOOLEAN NOT NULL DEFAULT false,
    "smsTransactionalConsentAt" TIMESTAMP(3),
    "smsTransactionalConsentSource" TEXT,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CustomerAccount" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "providerEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CustomerToken" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followSellerId" TEXT,

    CONSTRAINT "CustomerToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CustomerVendor" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "followedAt" TIMESTAMP(3),
    "firstPurchaseAt" TIMESTAMP(3),
    "lastPurchaseAt" TIMESTAMP(3),
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "totalSpentCents" INTEGER NOT NULL DEFAULT 0,
    "relationshipSource" TEXT NOT NULL DEFAULT 'purchase',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "consentUpdatedAt" TIMESTAMP(3),
    "emailMarketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "pushNotificationConsent" BOOLEAN NOT NULL DEFAULT false,
    "smsMarketingConsent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CustomerVendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Drop" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "fulfillment" TEXT NOT NULL DEFAULT 'pickup',
    "pickupInfo" TEXT,
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" TEXT NOT NULL DEFAULT 'preorder',
    "pickupAddress" TEXT,
    "pickupEndAt" TIMESTAMP(3),
    "pickupLat" DOUBLE PRECISION,
    "pickupLng" DOUBLE PRECISION,
    "pickupLocationName" TEXT,
    "pickupNotes" TEXT,
    "pickupStartAt" TIMESTAMP(3),
    "pickupCity" TEXT,
    "pickupCountry" TEXT,
    "pickupLine1" TEXT,
    "pickupPostal" TEXT,
    "pickupState" TEXT,
    "pickupFindMe" TEXT,
    "vendorArrivedAt" TIMESTAMP(3),
    "isPublic" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Drop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DropMeetCandidate" (
    "id" TEXT NOT NULL,
    "regionId" TEXT,
    "entityType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "externalId" TEXT,
    "rawName" TEXT NOT NULL,
    "rawAddress" TEXT,
    "rawSchedule" TEXT,
    "rawDescription" TEXT,
    "rawWebsite" TEXT,
    "rawPhone" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "normalizedData" JSONB,
    "confidenceScore" DOUBLE PRECISION,
    "insideRegion" BOOLEAN,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "promotedLocationId" TEXT,
    "promotedMarketId" TEXT,
    "promotedEventId" TEXT,
    "suggestedDuplicateId" TEXT,
    "reviewNotes" TEXT,
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DropMeetCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Event" (
    "id" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "locationId" TEXT,
    "marketId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "eventType" TEXT NOT NULL DEFAULT 'other',
    "startDateTime" TIMESTAMP(3) NOT NULL,
    "endDateTime" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "imageUrl" TEXT,
    "websiteUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verificationStatus" TEXT NOT NULL DEFAULT 'community_submitted',
    "sourceType" TEXT NOT NULL DEFAULT 'community_submission',
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "submittedBySellerId" TEXT,
    "approvedByAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "reviewNotes" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "candidateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GalleryImage" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Location" (
    "id" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "locationType" TEXT NOT NULL DEFAULT 'other',
    "description" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "websiteUrl" TEXT,
    "instagramUrl" TEXT,
    "facebookUrl" TEXT,
    "phone" TEXT,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verificationStatus" TEXT NOT NULL DEFAULT 'community_submitted',
    "sourceType" TEXT NOT NULL DEFAULT 'community_submission',
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "submittedBySellerId" TEXT,
    "submittedByCustomerId" TEXT,
    "approvedByAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "reviewNotes" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "candidateId" TEXT,
    "duplicateOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LocationFollow" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Market" (
    "id" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "marketType" TEXT NOT NULL DEFAULT 'other',
    "websiteUrl" TEXT,
    "instagramUrl" TEXT,
    "phone" TEXT,
    "imageUrl" TEXT,
    "organizerName" TEXT,
    "organizerEmail" TEXT,
    "claimedBySellerId" TEXT,
    "isClaimed" BOOLEAN NOT NULL DEFAULT false,
    "claimedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verificationStatus" TEXT NOT NULL DEFAULT 'community_submitted',
    "sourceType" TEXT NOT NULL DEFAULT 'community_submission',
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "submittedBySellerId" TEXT,
    "submittedByCustomerId" TEXT,
    "approvedByAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "reviewNotes" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "candidateId" TEXT,
    "duplicateOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MarketFollow" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MarketSchedule" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "recurrence" TEXT NOT NULL DEFAULT 'weekly',
    "dayOfWeek" INTEGER,
    "weekOfMonth" INTEGER,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "startTime" TEXT,
    "endTime" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MarketScheduleException" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'cancelled',
    "startTime" TEXT,
    "endTime" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketScheduleException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderType" TEXT NOT NULL,
    "senderSellerId" TEXT,
    "senderCustomerId" TEXT,
    "body" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'text',
    "dropId" TEXT,
    "orderId" TEXT,
    "broadcastId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MessageDelivery" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "detail" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "recipientType" TEXT NOT NULL,
    "sellerId" TEXT,
    "customerId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "dropId" TEXT,
    "orderId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Order" (
    "id" TEXT NOT NULL,
    "dropId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "buyerPhone" TEXT,
    "note" TEXT,
    "totalCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'new',
    "stripeSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "source" TEXT NOT NULL DEFAULT 'online',
    "customerArrivedAt" TIMESTAMP(3),
    "customerId" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProWaitlist" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sellerId" TEXT,
    "storeName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProWaitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Product" (
    "id" TEXT NOT NULL,
    "dropId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🍪',
    "imageUrl" TEXT,
    "inventory" INTEGER NOT NULL DEFAULT 0,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "condition" TEXT,
    "productType" TEXT,
    "rarity" TEXT,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vendorProductId" TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'signed_up',
    "rewardGrantedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "boundaryGeoJson" TEXT,
    "boundarySource" TEXT,
    "boundaryFetchedAt" TIMESTAMP(3),
    "minLatitude" DOUBLE PRECISION,
    "minLongitude" DOUBLE PRECISION,
    "maxLatitude" DOUBLE PRECISION,
    "maxLongitude" DOUBLE PRECISION,
    "defaultCenterLatitude" DOUBLE PRECISION NOT NULL,
    "defaultCenterLongitude" DOUBLE PRECISION NOT NULL,
    "defaultZoom" DOUBLE PRECISION NOT NULL DEFAULT 9,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReminderLog" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Review" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "serviceRating" INTEGER NOT NULL,
    "qualityRating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalesRep" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "referralCode" TEXT,
    "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "inviteAcceptedAt" TIMESTAMP(3),
    "inviteSentAt" TIMESTAMP(3),
    "phone" TEXT,
    "userId" TEXT,

    CONSTRAINT "SalesRep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SavedDrop" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "dropId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedDrop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Seller" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tagline" TEXT,
    "bio" TEXT,
    "location" TEXT,
    "accent" TEXT NOT NULL DEFAULT '#ff666c',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripeAccountId" TEXT,
    "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "feeMode" TEXT NOT NULL DEFAULT 'absorb',
    "geofenceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "geofenceRadiusM" INTEGER NOT NULL DEFAULT 1500,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "termsAcceptedAt" TIMESTAMP(3),
    "termsVersion" TEXT,
    "logoUrl" TEXT,
    "dropsCreated" INTEGER NOT NULL DEFAULT 0,
    "partnerActivatedAt" TIMESTAMP(3),
    "partnerExpiresAt" TIMESTAMP(3),
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "subscriptionStatus" TEXT,
    "category" TEXT NOT NULL DEFAULT 'food',
    "headerImageUrl" TEXT,
    "facebook" TEXT,
    "instagram" TEXT,
    "tiktok" TEXT,
    "twitter" TEXT,
    "website" TEXT,
    "youtube" TEXT,
    "growthBonusUntil" TIMESTAMP(3),
    "referralCode" TEXT,
    "disabledAt" TIMESTAMP(3),
    "timezone" TEXT,
    "referralCodeUsed" TEXT,
    "referredAt" TIMESTAMP(3),
    "salesRepId" TEXT,
    "pickupContactPhone" TEXT,
    "pickupContactPref" TEXT NOT NULL DEFAULT 'text',
    "discoveryRadius" INTEGER NOT NULL DEFAULT 25,
    "hideExactAddress" BOOLEAN NOT NULL DEFAULT true,
    "isDiscoverable" BOOLEAN NOT NULL DEFAULT false,
    "publicCity" TEXT,
    "publicNeighborhood" TEXT,
    "publicState" TEXT,
    "publicZip" TEXT,
    "showActiveDropsInDiscovery" BOOLEAN NOT NULL DEFAULT true,
    "showEventsInDiscovery" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Seller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Subscriber" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "dropId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "optInNotifications" BOOLEAN NOT NULL DEFAULT true,
    "optInGeofence" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'waitlist',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "optInEmail" BOOLEAN NOT NULL DEFAULT true,
    "optInSms" BOOLEAN NOT NULL DEFAULT false,
    "smsConsentAt" TIMESTAMP(3),

    CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Token" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VendorAppearance" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "locationId" TEXT,
    "marketId" TEXT,
    "eventId" TEXT,
    "dropId" TEXT,
    "startDateTime" TIMESTAMP(3) NOT NULL,
    "endDateTime" TIMESTAMP(3),
    "boothInfo" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorAppearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VendorLead" (
    "id" TEXT NOT NULL,
    "locationId" TEXT,
    "marketId" TEXT,
    "businessName" TEXT NOT NULL,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "submitterEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VendorProduct" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "emoji" TEXT NOT NULL DEFAULT '🍪',
    "imageUrl" TEXT,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT,
    "allergens" TEXT,
    "productType" TEXT,
    "condition" TEXT,
    "rarity" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Broadcast_sellerId_createdAt_idx" ON "public"."Broadcast"("sellerId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "ClaimRequest_locationId_idx" ON "public"."ClaimRequest"("locationId" ASC);

-- CreateIndex
CREATE INDEX "ClaimRequest_marketId_idx" ON "public"."ClaimRequest"("marketId" ASC);

-- CreateIndex
CREATE INDEX "ClaimRequest_status_createdAt_idx" ON "public"."ClaimRequest"("status" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CommissionLedger_orderId_salesRepId_key" ON "public"."CommissionLedger"("orderId" ASC, "salesRepId" ASC);

-- CreateIndex
CREATE INDEX "CommissionLedger_salesRepId_idx" ON "public"."CommissionLedger"("salesRepId" ASC);

-- CreateIndex
CREATE INDEX "CommissionLedger_status_idx" ON "public"."CommissionLedger"("status" ASC);

-- CreateIndex
CREATE INDEX "CommissionLedger_vendorId_idx" ON "public"."CommissionLedger"("vendorId" ASC);

-- CreateIndex
CREATE INDEX "Conversation_customerId_lastMessageAt_idx" ON "public"."Conversation"("customerId" ASC, "lastMessageAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_sellerId_customerId_key" ON "public"."Conversation"("sellerId" ASC, "customerId" ASC);

-- CreateIndex
CREATE INDEX "Conversation_sellerId_lastMessageAt_idx" ON "public"."Conversation"("sellerId" ASC, "lastMessageAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_email_key" ON "public"."Customer"("email" ASC);

-- CreateIndex
CREATE INDEX "Customer_firstVendorId_idx" ON "public"."Customer"("firstVendorId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_stripeCustomerId_key" ON "public"."Customer"("stripeCustomerId" ASC);

-- CreateIndex
CREATE INDEX "CustomerAccount_customerId_idx" ON "public"."CustomerAccount"("customerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAccount_provider_providerAccountId_key" ON "public"."CustomerAccount"("provider" ASC, "providerAccountId" ASC);

-- CreateIndex
CREATE INDEX "CustomerToken_customerId_idx" ON "public"."CustomerToken"("customerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerToken_tokenHash_key" ON "public"."CustomerToken"("tokenHash" ASC);

-- CreateIndex
CREATE INDEX "CustomerVendor_customerId_lastPurchaseAt_idx" ON "public"."CustomerVendor"("customerId" ASC, "lastPurchaseAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerVendor_customerId_sellerId_key" ON "public"."CustomerVendor"("customerId" ASC, "sellerId" ASC);

-- CreateIndex
CREATE INDEX "CustomerVendor_sellerId_followedAt_idx" ON "public"."CustomerVendor"("sellerId" ASC, "followedAt" ASC);

-- CreateIndex
CREATE INDEX "Drop_status_idx" ON "public"."Drop"("status" ASC);

-- CreateIndex
CREATE INDEX "DropMeetCandidate_regionId_status_idx" ON "public"."DropMeetCandidate"("regionId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "DropMeetCandidate_sourceType_externalId_key" ON "public"."DropMeetCandidate"("sourceType" ASC, "externalId" ASC);

-- CreateIndex
CREATE INDEX "DropMeetCandidate_status_entityType_idx" ON "public"."DropMeetCandidate"("status" ASC, "entityType" ASC);

-- CreateIndex
CREATE INDEX "Event_latitude_longitude_idx" ON "public"."Event"("latitude" ASC, "longitude" ASC);

-- CreateIndex
CREATE INDEX "Event_regionId_status_startDateTime_idx" ON "public"."Event"("regionId" ASC, "status" ASC, "startDateTime" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "public"."Event"("slug" ASC);

-- CreateIndex
CREATE INDEX "Event_status_startDateTime_idx" ON "public"."Event"("status" ASC, "startDateTime" ASC);

-- CreateIndex
CREATE INDEX "GalleryImage_sellerId_idx" ON "public"."GalleryImage"("sellerId" ASC);

-- CreateIndex
CREATE INDEX "Location_latitude_longitude_idx" ON "public"."Location"("latitude" ASC, "longitude" ASC);

-- CreateIndex
CREATE INDEX "Location_regionId_status_idx" ON "public"."Location"("regionId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Location_slug_key" ON "public"."Location"("slug" ASC);

-- CreateIndex
CREATE INDEX "Location_status_locationType_idx" ON "public"."Location"("status" ASC, "locationType" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "LocationFollow_customerId_locationId_key" ON "public"."LocationFollow"("customerId" ASC, "locationId" ASC);

-- CreateIndex
CREATE INDEX "LocationFollow_locationId_idx" ON "public"."LocationFollow"("locationId" ASC);

-- CreateIndex
CREATE INDEX "Market_locationId_idx" ON "public"."Market"("locationId" ASC);

-- CreateIndex
CREATE INDEX "Market_regionId_status_idx" ON "public"."Market"("regionId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Market_slug_key" ON "public"."Market"("slug" ASC);

-- CreateIndex
CREATE INDEX "Market_status_marketType_idx" ON "public"."Market"("status" ASC, "marketType" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MarketFollow_customerId_marketId_key" ON "public"."MarketFollow"("customerId" ASC, "marketId" ASC);

-- CreateIndex
CREATE INDEX "MarketFollow_marketId_idx" ON "public"."MarketFollow"("marketId" ASC);

-- CreateIndex
CREATE INDEX "MarketSchedule_marketId_active_idx" ON "public"."MarketSchedule"("marketId" ASC, "active" ASC);

-- CreateIndex
CREATE INDEX "MarketScheduleException_marketId_date_idx" ON "public"."MarketScheduleException"("marketId" ASC, "date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MarketScheduleException_marketId_date_key" ON "public"."MarketScheduleException"("marketId" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "Message_broadcastId_idx" ON "public"."Message"("broadcastId" ASC);

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "public"."Message"("conversationId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MessageDelivery_messageId_channel_key" ON "public"."MessageDelivery"("messageId" ASC, "channel" ASC);

-- CreateIndex
CREATE INDEX "Notification_customerId_readAt_createdAt_idx" ON "public"."Notification"("customerId" ASC, "readAt" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Notification_sellerId_readAt_createdAt_idx" ON "public"."Notification"("sellerId" ASC, "readAt" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "public"."Order"("customerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Order_stripeSessionId_key" ON "public"."Order"("stripeSessionId" ASC);

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_idx" ON "public"."OrderEvent"("orderId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ProWaitlist_email_key" ON "public"."ProWaitlist"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Referral_referredId_key" ON "public"."Referral"("referredId" ASC);

-- CreateIndex
CREATE INDEX "Referral_referrerId_idx" ON "public"."Referral"("referrerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Region_slug_key" ON "public"."Region"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ReminderLog_sellerId_email_kind_key" ON "public"."ReminderLog"("sellerId" ASC, "email" ASC, "kind" ASC);

-- CreateIndex
CREATE INDEX "Review_sellerId_idx" ON "public"."Review"("sellerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SalesRep_email_key" ON "public"."SalesRep"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SalesRep_referralCode_key" ON "public"."SalesRep"("referralCode" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SalesRep_userId_key" ON "public"."SalesRep"("userId" ASC);

-- CreateIndex
CREATE INDEX "SavedDrop_customerId_createdAt_idx" ON "public"."SavedDrop"("customerId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "SavedDrop_customerId_dropId_key" ON "public"."SavedDrop"("customerId" ASC, "dropId" ASC);

-- CreateIndex
CREATE INDEX "SavedDrop_dropId_idx" ON "public"."SavedDrop"("dropId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Seller_email_key" ON "public"."Seller"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Seller_referralCode_key" ON "public"."Seller"("referralCode" ASC);

-- CreateIndex
CREATE INDEX "Seller_salesRepId_idx" ON "public"."Seller"("salesRepId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Seller_slug_key" ON "public"."Seller"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Seller_stripeAccountId_key" ON "public"."Seller"("stripeAccountId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Seller_stripeCustomerId_key" ON "public"."Seller"("stripeCustomerId" ASC);

-- CreateIndex
CREATE INDEX "Subscriber_dropId_idx" ON "public"."Subscriber"("dropId" ASC);

-- CreateIndex
CREATE INDEX "Subscriber_sellerId_idx" ON "public"."Subscriber"("sellerId" ASC);

-- CreateIndex
CREATE INDEX "Token_sellerId_idx" ON "public"."Token"("sellerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Token_tokenHash_key" ON "public"."Token"("tokenHash" ASC);

-- CreateIndex
CREATE INDEX "VendorAppearance_eventId_startDateTime_status_idx" ON "public"."VendorAppearance"("eventId" ASC, "startDateTime" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "VendorAppearance_locationId_startDateTime_status_idx" ON "public"."VendorAppearance"("locationId" ASC, "startDateTime" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "VendorAppearance_marketId_startDateTime_status_idx" ON "public"."VendorAppearance"("marketId" ASC, "startDateTime" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "VendorAppearance_sellerId_startDateTime_idx" ON "public"."VendorAppearance"("sellerId" ASC, "startDateTime" ASC);

-- CreateIndex
CREATE INDEX "VendorAppearance_status_startDateTime_idx" ON "public"."VendorAppearance"("status" ASC, "startDateTime" ASC);

-- CreateIndex
CREATE INDEX "VendorLead_status_createdAt_idx" ON "public"."VendorLead"("status" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "VendorProduct_sellerId_idx" ON "public"."VendorProduct"("sellerId" ASC);

-- AddForeignKey
ALTER TABLE "public"."Broadcast" ADD CONSTRAINT "Broadcast_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "public"."Drop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Broadcast" ADD CONSTRAINT "Broadcast_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "public"."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClaimRequest" ADD CONSTRAINT "ClaimRequest_claimantSellerId_fkey" FOREIGN KEY ("claimantSellerId") REFERENCES "public"."Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClaimRequest" ADD CONSTRAINT "ClaimRequest_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClaimRequest" ADD CONSTRAINT "ClaimRequest_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "public"."Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClaimRequest" ADD CONSTRAINT "ClaimRequest_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "public"."Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommissionLedger" ADD CONSTRAINT "CommissionLedger_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "public"."SalesRep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommissionLedger" ADD CONSTRAINT "CommissionLedger_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "public"."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_lastDropId_fkey" FOREIGN KEY ("lastDropId") REFERENCES "public"."Drop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_lastOrderId_fkey" FOREIGN KEY ("lastOrderId") REFERENCES "public"."Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "public"."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Customer" ADD CONSTRAINT "Customer_firstDropId_fkey" FOREIGN KEY ("firstDropId") REFERENCES "public"."Drop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Customer" ADD CONSTRAINT "Customer_firstVendorId_fkey" FOREIGN KEY ("firstVendorId") REFERENCES "public"."Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerAccount" ADD CONSTRAINT "CustomerAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerToken" ADD CONSTRAINT "CustomerToken_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerVendor" ADD CONSTRAINT "CustomerVendor_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerVendor" ADD CONSTRAINT "CustomerVendor_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "public"."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Drop" ADD CONSTRAINT "Drop_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "public"."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DropMeetCandidate" ADD CONSTRAINT "DropMeetCandidate_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "public"."Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DropMeetCandidate" ADD CONSTRAINT "DropMeetCandidate_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "public"."Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Event" ADD CONSTRAINT "Event_approvedByAdminId_fkey" FOREIGN KEY ("approvedByAdminId") REFERENCES "public"."Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Event" ADD CONSTRAINT "Event_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Event" ADD CONSTRAINT "Event_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "public"."Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Event" ADD CONSTRAINT "Event_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "public"."Region"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Event" ADD CONSTRAINT "Event_submittedBySellerId_fkey" FOREIGN KEY ("submittedBySellerId") REFERENCES "public"."Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GalleryImage" ADD CONSTRAINT "GalleryImage_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "public"."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Location" ADD CONSTRAINT "Location_approvedByAdminId_fkey" FOREIGN KEY ("approvedByAdminId") REFERENCES "public"."Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Location" ADD CONSTRAINT "Location_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "public"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Location" ADD CONSTRAINT "Location_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "public"."Region"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Location" ADD CONSTRAINT "Location_submittedByCustomerId_fkey" FOREIGN KEY ("submittedByCustomerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Location" ADD CONSTRAINT "Location_submittedBySellerId_fkey" FOREIGN KEY ("submittedBySellerId") REFERENCES "public"."Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LocationFollow" ADD CONSTRAINT "LocationFollow_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LocationFollow" ADD CONSTRAINT "LocationFollow_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Market" ADD CONSTRAINT "Market_approvedByAdminId_fkey" FOREIGN KEY ("approvedByAdminId") REFERENCES "public"."Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Market" ADD CONSTRAINT "Market_claimedBySellerId_fkey" FOREIGN KEY ("claimedBySellerId") REFERENCES "public"."Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Market" ADD CONSTRAINT "Market_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "public"."Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Market" ADD CONSTRAINT "Market_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Market" ADD CONSTRAINT "Market_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "public"."Region"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Market" ADD CONSTRAINT "Market_submittedByCustomerId_fkey" FOREIGN KEY ("submittedByCustomerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Market" ADD CONSTRAINT "Market_submittedBySellerId_fkey" FOREIGN KEY ("submittedBySellerId") REFERENCES "public"."Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MarketFollow" ADD CONSTRAINT "MarketFollow_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MarketFollow" ADD CONSTRAINT "MarketFollow_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "public"."Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MarketSchedule" ADD CONSTRAINT "MarketSchedule_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "public"."Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MarketScheduleException" ADD CONSTRAINT "MarketScheduleException_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "public"."Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "public"."Broadcast"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "public"."Drop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_senderCustomerId_fkey" FOREIGN KEY ("senderCustomerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_senderSellerId_fkey" FOREIGN KEY ("senderSellerId") REFERENCES "public"."Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MessageDelivery" ADD CONSTRAINT "MessageDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "public"."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "public"."Drop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "public"."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Product" ADD CONSTRAINT "Product_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "public"."Drop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Product" ADD CONSTRAINT "Product_vendorProductId_fkey" FOREIGN KEY ("vendorProductId") REFERENCES "public"."VendorProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Referral" ADD CONSTRAINT "Referral_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "public"."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "public"."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Review" ADD CONSTRAINT "Review_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "public"."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SavedDrop" ADD CONSTRAINT "SavedDrop_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SavedDrop" ADD CONSTRAINT "SavedDrop_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "public"."Drop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Seller" ADD CONSTRAINT "Seller_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "public"."SalesRep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Subscriber" ADD CONSTRAINT "Subscriber_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "public"."Drop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Subscriber" ADD CONSTRAINT "Subscriber_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "public"."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Token" ADD CONSTRAINT "Token_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "public"."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VendorAppearance" ADD CONSTRAINT "VendorAppearance_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "public"."Drop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VendorAppearance" ADD CONSTRAINT "VendorAppearance_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VendorAppearance" ADD CONSTRAINT "VendorAppearance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VendorAppearance" ADD CONSTRAINT "VendorAppearance_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "public"."Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VendorAppearance" ADD CONSTRAINT "VendorAppearance_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "public"."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VendorLead" ADD CONSTRAINT "VendorLead_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "public"."Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VendorLead" ADD CONSTRAINT "VendorLead_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "public"."Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VendorProduct" ADD CONSTRAINT "VendorProduct_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "public"."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

