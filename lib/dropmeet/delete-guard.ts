import { prisma } from "@/lib/db";

/**
 * Deleting a DropMeet place or market, without a window for losing a vendor's
 * published appearance.
 *
 * ── THE RACE THIS EXISTS TO CLOSE ─────────────────────────────────────────
 *
 * The obvious shape is wrong:
 *
 *     const n = await countAppearances(id);   // t0 — zero
 *     if (n > 0) refuse();                    //      so we proceed
 *     await prisma.location.delete({ id });   // t1 — cascades
 *
 * A vendor who commits an appearance between t0 and t1 has it erased by the
 * cascade at t1, and the count that was supposed to protect them was taken
 * before they existed. Checking harder at t0 cannot fix this; the check and
 * the delete have to be one indivisible step.
 *
 * ── HOW IT IS CLOSED ──────────────────────────────────────────────────────
 *
 * Postgres already serialises this for us, through the foreign keys that make
 * the cascade possible in the first place. Inserting a VendorAppearance must
 * validate its `locationId` / `marketId` against the parent row, and that
 * validation takes a FOR KEY SHARE lock on the parent. FOR KEY SHARE conflicts
 * with FOR UPDATE. So if we take FOR UPDATE on the parent rows BEFORE counting,
 * there are only two possible orderings left, and both are safe:
 *
 *   • The insert got there first. Our FOR UPDATE waits for it to commit, so by
 *     the time we count, the appearance is visible and we refuse.
 *
 *   • We got there first. The insert blocks until we commit. If we deleted,
 *     its FK validation then fails against a parent that is gone, so the
 *     vendor gets an error instead of a silently discarded plan.
 *
 * There is no third ordering in which a committed appearance disappears.
 *
 * ── WHICH ROWS HAVE TO BE LOCKED ──────────────────────────────────────────
 *
 * An appearance can hang off the place OR off one of the place's markets, and
 * a market cascades when the place does. So locking the Location alone is not
 * enough — an insert carrying `marketId` validates against the Market row and
 * would never touch our lock. We lock the place AND every market at it:
 *
 *   • Location locked  → no new direct appearances, and no new markets
 *                        (creating one validates against this same row)
 *   • its Markets locked → no new appearances at any of them
 *
 * Together those cover every row the cascade would reach.
 *
 * ── WHY NOT SERIALIZABLE ──────────────────────────────────────────────────
 *
 * `isolationLevel: "Serializable"` would also detect this, but it reports it
 * as a 40001 serialisation failure that the caller has to retry or translate.
 * Explicit row locks make the outcome deterministic: the caller gets
 * "deleted", "blocked" or "missing", never "try again".
 */

export type DeleteOutcome = "deleted" | "blocked" | "missing";

/**
 * Delete a place, but only if no vendor appearance is attached — including
 * appearances reached through its markets. Callers must do their own
 * authorisation first; this module is deliberately not a server action.
 */
export async function deleteLocationIfUnused(id: string): Promise<DeleteOutcome> {
  return prisma.$transaction(async (tx) => {
    // Lock first, count second. The order is the whole point.
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "Location" WHERE "id" = ${id} FOR UPDATE`;
    if (locked.length === 0) return "missing";

    await tx.$queryRaw`SELECT "id" FROM "Market" WHERE "locationId" = ${id} FOR UPDATE`;

    const [direct, viaMarket] = await Promise.all([
      tx.vendorAppearance.count({ where: { locationId: id } }),
      tx.vendorAppearance.count({ where: { market: { locationId: id } } }),
    ]);
    if (direct + viaMarket > 0) return "blocked";

    await tx.location.delete({ where: { id } });
    return "deleted";
  });
}

/**
 * The same guarantee for a market, which cascades to the appearances held at
 * it. Locking the Market row is sufficient here: an appearance at a market
 * validates against exactly this row.
 */
export async function deleteMarketIfUnused(id: string): Promise<DeleteOutcome> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "Market" WHERE "id" = ${id} FOR UPDATE`;
    if (locked.length === 0) return "missing";

    const appearances = await tx.vendorAppearance.count({ where: { marketId: id } });
    if (appearances > 0) return "blocked";

    await tx.market.delete({ where: { id } });
    return "deleted";
  });
}
