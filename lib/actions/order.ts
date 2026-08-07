"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getStripe, calcFeeCents } from "@/lib/stripe";
import { sendEmail, orderReceivedEmail } from "@/lib/email";
import { orderMailPickup, pickupSummary } from "@/lib/pickup";
import { dropMapsUrl } from "@/lib/maps";
import { sendSms } from "@/lib/notifications";
import { isDemoStore } from "@/lib/demo";
import { upsertCustomer } from "@/lib/customer-auth";
import { applyFirstTouch, recordRelationship } from "@/lib/attribution";

export type OrderState = { error?: string };

async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export async function placeOrderAction(
  _prev: OrderState,
  formData: FormData
): Promise<OrderState> {
  const dropId = String(formData.get("dropId") ?? "");
  const buyerName = String(formData.get("buyerName") ?? "").trim();
  const buyerEmail = String(formData.get("buyerEmail") ?? "").trim().toLowerCase();
  const buyerPhone = String(formData.get("buyerPhone") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!buyerName) return { error: "Please add your name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyerEmail))
    return { error: "Please add a valid email for your receipt." };
  if ((buyerPhone ?? "").replace(/\D/g, "").length < 10)
    return { error: "Please add a mobile number so we can text you order updates." };

  const drop = await prisma.drop.findUnique({
    where: { id: dropId },
    include: { products: true, seller: true },
  });
  if (!drop) return { error: "This drop no longer exists." };
  if (drop.status !== "live") return { error: "Ordering for this drop is closed." };
  // Enforce the drop's own ordering window (status alone isn't enough).
  const orderNow = new Date();
  if (drop.opensAt && orderNow < drop.opensAt)
    return { error: "Ordering hasn't opened yet for this drop." };
  if (drop.closesAt && orderNow > drop.closesAt)
    return { error: "Ordering for this drop has closed." };
  // A suspended vendor can't take orders.
  if (drop.seller.disabledAt)
    return { error: "This store is currently unavailable." };
  // The marketing showcase is a visual demo only — never takes real orders.
  if (isDemoStore(drop.seller))
    return { error: "This is a demo storefront. Sign up free to open your own store and take real orders!" };

  // Build line items from server-trusted prices + inventory
  const lines: { product: (typeof drop.products)[number]; qty: number }[] = [];
  for (const p of drop.products) {
    const qty = Math.max(0, parseInt(String(formData.get(`qty_${p.id}`) ?? "0"), 10) || 0);
    if (qty <= 0) continue;
    const remaining = p.inventory - p.sold;
    if (qty > remaining) {
      return { error: `Only ${remaining} left of ${p.name}. Adjust your cart.` };
    }
    lines.push({ product: p, qty });
  }
  if (lines.length === 0) return { error: "Add at least one item to your order." };

  const itemsCents = lines.reduce((s, l) => s + l.product.priceCents * l.qty, 0);
  const feeCents = calcFeeCents(itemsCents);
  const passFee = drop.seller.feeMode === "pass";
  // What the customer pays. In "pass" mode the DropQ fee is added on top.
  const totalCents = passFee ? itemsCents + feeCents : itemsCents;

  // Order source: a live-selling drop produces "live" (on-site QR) orders.
  const source = drop.mode === "live" ? "live" : "online";
  // Live customers can choose to pay in person (cash/card at the booth).
  const payInPerson = String(formData.get("payInPerson") ?? "") === "1";

  const stripe = getStripe();
  const useStripe =
    !!stripe &&
    drop.seller.stripeChargesEnabled &&
    !!drop.seller.stripeAccountId &&
    !payInPerson;

  // Give the buyer a durable Customer identity at checkout so messaging works
  // from their very first order. Never blocks the sale — if this fails the
  // order still goes through and the backfill picks it up later.
  const customer = await upsertCustomer({
    email: buyerEmail,
    name: buyerName,
    phone: buyerPhone,
  }).catch((e) => {
    console.error("upsertCustomer at checkout failed:", e);
    return null;
  });
  const customerId = customer?.id ?? null;

  // Attribution. Best-effort and never allowed to block a sale: a customer who
  // reached checkout through this vendor is attributed to them if they have no
  // earlier first touch, and the vendor relationship is recorded either way.
  if (customerId) {
    await applyFirstTouch(customerId, {
      vendorId: drop.sellerId,
      dropId: drop.id,
      source: "checkout",
      detail: drop.seller.slug,
    }).catch(() => {});
    await recordRelationship({
      customerId,
      sellerId: drop.sellerId,
      source: "purchase",
      // Buying is not consent to be marketed to — no implicit follow.
      purchase: { at: new Date(), amountCents: totalCents },
    }).catch(() => {});
  }

  // ----- Real payments via Stripe Connect (destination charge + platform fee) -----
  if (useStripe && stripe) {
    const order = await prisma.order.create({
      data: {
        dropId: drop.id,
        sellerId: drop.sellerId,
        buyerName,
        buyerEmail,
        buyerPhone,
        customerId,
        note,
        totalCents,
        feeCents,
        status: "pending",
        source,
        paymentStatus: "pending",
        events: { create: { type: "created", detail: source } },
        items: {
          create: lines.map((l) => ({
            productId: l.product.id,
            name: l.product.name,
            priceCents: l.product.priceCents,
            quantity: l.qty,
          })),
        },
      },
    });

    const base = await baseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: buyerEmail,
      line_items: [
        ...lines.map((l) => ({
          quantity: l.qty,
          price_data: {
            currency: "usd",
            unit_amount: l.product.priceCents,
            product_data: {
              name: l.product.name,
              ...(l.product.description ? { description: l.product.description } : {}),
            },
          },
        })),
        // In "pass" mode, the DropQ fee is a separate line the customer pays.
        ...(passFee
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: "usd" as const,
                  unit_amount: feeCents,
                  product_data: { name: "Service fee" },
                },
              },
            ]
          : []),
      ],
      payment_intent_data: {
        // DropQ's clean platform cut. The vendor (merchant of record on this
        // direct charge) covers Stripe's processing fee.
        application_fee_amount: feeCents,
        metadata: { orderId: order.id },
      },
      metadata: { orderId: order.id },
      // Bound how long the order can sit "pending" so reconciliation can
      // definitively release/cancel abandoned checkouts (min 30 min).
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
      success_url: `${base}/order/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/s/${drop.seller.slug}/${drop.id}?canceled=1`,
    },
    // Direct charge: create the Checkout Session on the vendor's connected account.
    { stripeAccount: drop.seller.stripeAccountId! });

    await prisma.order.update({
      where: { id: order.id },
      data: { stripeSessionId: session.id },
    });

    redirect(session.url!);
  }

  // ----- Demo mode (no Stripe configured): finalize immediately -----
  const order = await prisma
    .$transaction(async (tx) => {
      // Atomic conditional claim per item — no read-then-write race. If any
      // item can't be claimed, throw to roll back every increment.
      for (const l of lines) {
        const n = await tx.$executeRaw`
          UPDATE "Product" SET sold = sold + ${l.qty}
          WHERE id = ${l.product.id} AND sold + ${l.qty} <= inventory`;
        if (n === 0) throw new Error(`SOLD_OUT:${l.product.name}`);
      }
      return tx.order.create({
        data: {
          dropId: drop.id,
          sellerId: drop.sellerId,
          buyerName,
          buyerEmail,
          buyerPhone,
          customerId,
          note,
          totalCents,
          feeCents,
          status: "new",
          source,
          paymentStatus: "unpaid",
          events: { create: { type: "created", detail: source } },
          items: {
            create: lines.map((l) => ({
              productId: l.product.id,
              name: l.product.name,
              priceCents: l.product.priceCents,
              quantity: l.qty,
            })),
          },
        },
      });
    })
    .catch((e: unknown) => {
      if (e instanceof Error && e.message.startsWith("SOLD_OUT:")) return null;
      throw e;
    });

  if (!order) {
    return { error: "Sorry — an item just sold out. Refresh and try again." };
  }

  // Confirmation to the buyer (text + email), delivered in the background.
  const orderLink = `${await baseUrl()}/order/${order.id}`;
  const mail = orderReceivedEmail({
    to: buyerEmail,
    storeName: drop.seller.storeName,
    buyerFirst: buyerName.split(" ")[0] || buyerName,
    orderLink,
    ...orderMailPickup(drop, drop.seller),
  });
  // SMS: confirmation + pickup summary + a maps link when we have a location.
  const mapsUrl = dropMapsUrl(drop);
  const pickupLine = pickupSummary(drop, drop.seller.timezone);
  const smsText =
    `${drop.seller.storeName}: Got your order! 🎉 We'll text you when it's ready.` +
    (pickupLine ? ` ${pickupLine}.` : "") +
    (mapsUrl ? ` Directions: ${mapsUrl}` : "") +
    ` ${orderLink}`;
  after(async () => {
    await sendEmail(mail);
    await sendSms(buyerPhone, smsText);
  });

  revalidatePath(`/s/${drop.seller.slug}/${drop.id}`);
  revalidatePath(`/dashboard/drops/${drop.id}`);
  redirect(`/order/${order.id}`);
}

/**
 * Customer taps "I'm here" on their order screen at pickup. Records the arrival
 * and notifies the vendor (email always; SMS if they set a public number).
 * Public action — authorized by possession of the (unguessable) order link, and
 * scoped to a single valid order. Idempotent: only the first tap notifies.
 */
export async function customerArrivedAction(formData: FormData) {
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { drop: true, seller: true },
  });
  // Only a real, active order can check in.
  if (!order || ["pending", "canceled", "completed"].includes(order.status)) return;

  if (!order.customerArrivedAt) {
    await prisma.order.update({
      where: { id: orderId },
      data: { customerArrivedAt: new Date() },
    });

    const store = order.seller.storeName;
    const orderNo = `#${order.id.slice(-8).toUpperCase()}`;
    const dashLink = `${await baseUrl()}/dashboard/drops/${order.dropId}`;
    const vendorPhone = order.seller.pickupContactPhone;
    after(async () => {
      await sendEmail({
        to: order.seller.email,
        subject: `${order.buyerName} has arrived for order ${orderNo}`,
        html:
          `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">` +
          `<p><b>${order.buyerName}</b> just tapped “I’m here” for order <b>${orderNo}</b> ` +
          `on <b>${order.drop.title}</b>.</p>` +
          `<p><a href="${dashLink}" style="color:#ff6268">Open the drop →</a></p></div>`,
      });
      if (vendorPhone) {
        await sendSms(
          vendorPhone,
          `DropQ: ${order.buyerName} has arrived for order ${orderNo} (${order.drop.title}).`
        );
      }
    });
    revalidatePath(`/dashboard/drops/${order.dropId}`);
  }
  redirect(`/order/${orderId}?arrived=1`);
}
