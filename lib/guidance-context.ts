import "server-only";
import { cache } from "react";
import {
  activationCardVisible,
  activationFacts,
  activationState,
  type ActivationSeller,
} from "@/lib/activation";
import { guidanceFacts, loadGuidanceState } from "@/lib/guidance-state";
import {
  guidanceApplicable,
  NO_CAPABILITIES,
  type GuidanceCapabilities,
  type GuidanceFacts,
  type GuidanceState,
  type ActivationStateLike,
} from "@/lib/guidance";
import { isWalkUpEnabled } from "@/lib/walkup";
import { hasGrowthFeatures } from "@/lib/plans";

/**
 * Everything the client-side guidance layer needs, assembled once per render.
 *
 * WHY THE CLIENT COMPUTES THE DECISION. Coachmarks are route-specific, and a
 * layout has no pathname on the server. Rather than move guidance into every
 * page, the layout ships these facts to the client, which reads
 * `usePathname()` and calls the same pure `guidanceFor()`. That is exactly what
 * lib/guidance.ts was kept free of Prisma and `server-only` for.
 *
 * WHY IT IS SAFE TO SHIP. Everything here is already visible to this vendor —
 * their own counts, their own dismissals, their own Stripe readiness. No other
 * vendor's data, no secrets, no ids beyond their own.
 *
 * COST. Seven small indexed counts, all issued in parallel, plus one row read.
 * `activationFacts` is `cache()`d, so the overview page — which loads
 * activation itself — reuses this pass rather than repeating it. For a vendor
 * guidance does not apply to, nothing is queried at all.
 */
export type GuidancePayload = {
  applicable: boolean;
  storeName: string;
  state: GuidanceState;
  facts: GuidanceFacts;
  activation: ActivationStateLike;
  activationCardVisible: boolean;
  capabilities: GuidanceCapabilities;
};

type GuidanceSellerRow = ActivationSeller & {
  id: string;
  storeName: string;
  internalKind: string | null;
  plan: string;
  partnerExpiresAt: Date | null;
  dropsCreated: number;
  growthBonusUntil?: Date | null;
};

/** True when a DropMeet region is switched on, so DropMeet guidance can exist. */
const dropMeetLive = cache(async function dropMeetLive(): Promise<boolean> {
  const { prisma } = await import("@/lib/db");
  return (await prisma.region.count({ where: { active: true } })) > 0;
});

export async function loadGuidancePayload(
  seller: GuidanceSellerRow
): Promise<GuidancePayload> {
  const applicable = guidanceApplicable(seller);

  // A demo or internal account never sees guidance, so it never pays for it.
  if (!applicable) {
    return {
      applicable: false,
      storeName: seller.storeName,
      state: await loadGuidanceState(seller.id),
      facts: EMPTY_FACTS,
      activation: activationState(seller, { ...EMPTY_ACTIVATION_FACTS }),
      activationCardVisible: false,
      capabilities: NO_CAPABILITIES,
    };
  }

  const state = await loadGuidanceState(seller.id);
  const aFacts = await activationFacts(seller.id);
  const [facts, dropMeet] = await Promise.all([
    guidanceFacts(seller.id, aFacts),
    dropMeetLive(),
  ]);
  const activation = activationState(seller, aFacts);

  return {
    applicable: true,
    storeName: seller.storeName,
    state,
    facts,
    activation,
    activationCardVisible: activationCardVisible(activation),
    // ⚠️ Resolved from the SAME gates the features use. Guidance never
    // re-implements availability — the failure mode is teaching a vendor about
    // a button they do not have.
    capabilities: {
      walkUp: isWalkUpEnabled(seller),
      dropMeet,
      growthFeatures: hasGrowthFeatures(seller),
    },
  };
}

const EMPTY_ACTIVATION_FACTS = {
  dropsWithProducts: 0,
  liveDrops: 0,
  paidOrders: 0,
  hasShared: false,
};

const EMPTY_FACTS: GuidanceFacts = {
  ...EMPTY_ACTIVATION_FACTS,
  totalDrops: 0,
  dropsWithPaidOrders: 0,
  repeatCustomers: 0,
  dropsOpeningTomorrow: 0,
};
