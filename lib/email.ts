import "server-only";
import { generateAccessibleCtaColor } from "@/lib/color";

const RESEND_URL = "https://api.resend.com/emails";

type Mail = { to: string; subject: string; html: string };

export type SendResult = {
  ok: boolean;
  skipped?: boolean; // no API key — logged to console instead of sent
  status?: number;
  error?: string;
};

const LOGO_CID = "dropqlogo";
const LOGO_URL = "https://www.drop-q.com/brand/dropq-logo.png";

// Cache the logo bytes per lambda so we fetch it at most once. Embedding it as
// an inline (CID) attachment means the logo renders even when a mail client
// blocks remote images — which is why the hosted <img> showed a broken link.
let logoB64: string | null = null;
let logoFetched = false;
async function dropqLogoBase64(): Promise<string | null> {
  if (logoFetched) return logoB64;
  logoFetched = true;
  try {
    const res = await fetch(LOGO_URL);
    if (res.ok) logoB64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  } catch (e) {
    console.error("Logo fetch for email failed:", e);
  }
  return logoB64;
}

/**
 * Send an email via Resend if RESEND_API_KEY is set; otherwise log it to the
 * server console (dev mode) so flows work with zero paid services.
 * Returns a delivery result so callers (e.g. the admin test button) can report
 * success/failure. Existing callers that ignore the return value still work.
 */
export async function sendEmail({ to, subject, html }: Mail): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "DropQ <onboarding@resend.dev>";

  if (!key) {
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log(
      `\n──────── 📧 EMAIL (dev mode — set RESEND_API_KEY to send for real) ────────\n` +
        `To:      ${to}\nSubject: ${subject}\n${text}\n` +
        `────────────────────────────────────────────────────────────────────────\n`
    );
    return { ok: false, skipped: true, error: "RESEND_API_KEY is not set" };
  }

  // Inline the DropQ logo as a CID attachment when the template references it,
  // so it renders regardless of the client's remote-image settings.
  const payload: Record<string, unknown> = { from, to, subject, html };
  if (html.includes(`cid:${LOGO_CID}`)) {
    const b64 = await dropqLogoBase64();
    if (b64) {
      payload.attachments = [
        { filename: "dropq-logo.png", content: b64, content_id: LOGO_CID, content_type: "image/png" },
      ];
    }
  }

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("Resend email failed:", res.status, body);
      return { ok: false, status: res.status, error: body.slice(0, 400) };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    console.error("Resend email error:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function layout(heading: string, body: string, cta: { href: string; label: string }) {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fafafa;padding:32px">
    <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e8e8e8;border-radius:18px;overflow:hidden">
      <div style="background:#1a1a1a;padding:18px 24px">
        <img src="cid:dropqlogo" alt="DropQ" height="30" style="display:block;height:30px;width:auto;border:0" />
      </div>
      <div style="padding:28px 24px;color:#1a1a1a">
        <h1 style="font-size:20px;margin:0 0 12px">${heading}</h1>
        <p style="font-size:15px;line-height:1.55;color:#3d3d3d;margin:0 0 22px">${body}</p>
        <a href="${cta.href}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:12px">${cta.label}</a>
        <p style="font-size:12px;color:#6b6b6b;margin:22px 0 0">If the button doesn't work, copy this link:<br><span style="color:#ff6268;word-break:break-all">${cta.href}</span></p>
      </div>
    </div>
    <p style="text-align:center;color:#6b6b6b;font-size:12px;margin-top:16px">DropQ — the operating system for modern product drops</p>
  </div>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Pick black/white text for legibility on top of an arbitrary brand color. */
function readableOn(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#1a1a1a" : "#ffffff";
}

type Brand = { storeName: string; logoUrl?: string | null; accent?: string | null };

/**
 * Vendor-branded email shell for customer messages: the vendor's logo + name in
 * their store's accent color, a matching CTA, and a small DropQ credit in the
 * footer. The email reads as if it's from the vendor, not from DropQ.
 */
function vendorLayout(
  brand: Brand,
  heading: string,
  body: string,
  cta: { href: string; label: string }
) {
  const accent =
    brand.accent && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(brand.accent)
      ? brand.accent
      : "#1a1a1a";
  const onAccent = readableOn(accent);
  // Header bar keeps the brand color; the CTA button uses the accessible,
  // darkened derivative so white button text always passes contrast.
  const ctaBg = generateAccessibleCtaColor(accent);
  const name = esc(brand.storeName);
  // Email images need absolute URLs; resolve any relative storefront logo.
  const logoSrc = brand.logoUrl
    ? brand.logoUrl.startsWith("/")
      ? `https://www.drop-q.com${brand.logoUrl}`
      : brand.logoUrl
    : null;
  const logoCell = logoSrc
    ? `<td style="padding-right:12px;vertical-align:middle" width="48">
         <img src="${logoSrc}" alt="${name}" width="44" height="44" style="display:block;width:44px;height:44px;border-radius:10px;object-fit:cover;background:#fff;border:1px solid rgba(255,255,255,0.35)" />
       </td>`
    : "";
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fafafa;padding:32px">
    <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e8e8e8;border-radius:18px;overflow:hidden">
      <div style="background:${accent};padding:18px 24px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          ${logoCell}
          <td style="vertical-align:middle">
            <span style="font-size:20px;font-weight:700;letter-spacing:-0.01em;color:${onAccent}">${name}</span>
          </td>
        </tr></table>
      </div>
      <div style="padding:28px 24px;color:#1a1a1a">
        <h1 style="font-size:20px;margin:0 0 12px">${heading}</h1>
        <p style="font-size:15px;line-height:1.55;color:#3d3d3d;margin:0 0 22px">${body}</p>
        <a href="${cta.href}" style="display:inline-block;background:${ctaBg};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:12px">${cta.label}</a>
        <p style="font-size:12px;color:#6b6b6b;margin:22px 0 0">If the button doesn't work, copy this link:<br><span style="color:#6b6b6b;word-break:break-all">${cta.href}</span></p>
      </div>
    </div>
    <p style="text-align:center;color:#9aa0a6;font-size:12px;margin-top:16px">
      Powered by <a href="https://www.drop-q.com" style="color:#9aa0a6;text-decoration:underline">DropQ</a>
      &nbsp;·&nbsp; Want a store like this? <a href="https://www.drop-q.com" style="color:#9aa0a6;text-decoration:underline">Start free →</a>
    </p>
  </div>`;
}

export function dropqTestEmail(to: string): Mail {
  return {
    to,
    subject: "DropQ test email ✅",
    html: layout(
      "It works! 🎉",
      "This is a test email from DropQ. If you can see the DropQ logo in the header above " +
        "(even with remote images turned off), inline branding is rendering correctly.",
      { href: "https://www.drop-q.com", label: "Go to DropQ" }
    ),
  };
}

export function salesRepInviteEmail(o: {
  name: string;
  email: string;
  signupUrl: string;
  accountUrl: string;
}): Mail {
  return {
    to: o.email,
    subject: "You've been invited to sell with DropQ",
    html: layout(
      `Hi ${o.name},`,
      `You've been invited to earn commission with DropQ.<br><br>` +
        `Your vendor signup link is:<br><a href="${o.signupUrl}" style="color:#ff6268;word-break:break-all">${o.signupUrl}</a><br><br>` +
        `Vendors who subscribe through your link will be credited to your account. ` +
        `You earn <b>1% commission</b> on eligible vendor sales from referred vendors.<br><br>` +
        `Create your sales rep account using this email address: <b>${o.email}</b> to unlock your Referral Dashboard.`,
      { href: o.accountUrl, label: "Create Your Sales Rep Account" }
    ),
  };
}

export function verificationEmail(to: string, link: string): Mail {
  return {
    to,
    subject: "Verify your email for DropQ",
    html: layout(
      "Confirm your email",
      "Welcome to DropQ! Confirm your email address to secure your account and start selling.",
      { href: link, label: "Verify email" }
    ),
  };
}

export function resetEmail(to: string, link: string): Mail {
  return {
    to,
    subject: "Reset your DropQ password",
    html: layout(
      "Reset your password",
      "We received a request to reset your password. This link expires in 1 hour. If you didn't ask for this, you can safely ignore this email.",
      { href: link, label: "Reset password" }
    ),
  };
}

/**
 * Stripe has turned off card payments for a connected account, so the vendor
 * can no longer sell. Sent from the account.updated webhook on the
 * charge-ready -> not-charge-ready transition only.
 *
 * The urgency is real and the vendor has no other way to find out: their
 * storefront stops accepting orders the moment the flag flips, and until this
 * email existed the only signal was a dashboard banner they'd have to happen to
 * look at. A vendor whose Stripe breaks the night before a market needs to know
 * that night.
 */
export function sellingPausedEmail(o: {
  to: string;
  storeName: string;
  liveDrops: number;
  paymentsLink: string;
}): Mail {
  const impact =
    o.liveDrops > 0
      ? `Your ${o.liveDrops === 1 ? "live drop has" : `${o.liveDrops} live drops have`} stopped accepting orders, and customers see a “not accepting orders right now” message.`
      : `You won't be able to publish a drop or take orders until it's resolved.`;
  return {
    to: o.to,
    subject: `Action needed: card payments are paused for ${o.storeName}`,
    html: layout(
      "Card payments are paused",
      `Stripe has turned off card payments for <b>${esc(o.storeName)}</b>. ` +
        `${impact}<br><br>` +
        `This usually means Stripe needs something from you — identity verification, an updated document, or extra business details. ` +
        `Open your payments settings to see exactly what Stripe is asking for.<br><br>` +
        `<b>Nothing has been lost.</b> Your drops, products, orders and customers are all safe, ` +
        `you can keep editing drafts, and you can still close or unpublish a live drop. ` +
        `Selling resumes automatically as soon as Stripe clears your account.`,
      { href: o.paymentsLink, label: "Fix this in payments settings" }
    ),
  };
}

type OrderMail = {
  to: string;
  storeName: string;
  buyerFirst: string;
  orderLink: string;
  pickupInfo?: string | null;
  fulfillment?: string;
  pickupWindow?: string | null; // formatted pickup date/time range
  pickupWhere?: string | null; // pickup location line
  pickupFindMe?: string | null; // how to find the vendor ("Blue canopy…")
  mapsUrl?: string | null; // "Open in Maps" link
  contactPhone?: string | null; // public pickup contact number (opt-in)
  contactPref?: string | null; // text | call | both
  logoUrl?: string | null;
  accent?: string | null;
};

/** "Open in Maps" inline button for emails. */
function mapsAnchor(url?: string | null): string {
  if (!url) return "";
  return `<br><a href="${url}" style="display:inline-block;margin-top:8px;color:#1a73e8;text-decoration:underline;font-weight:600">📍 Open in Maps</a>`;
}

/** Vendor contact line (only when a public number is provided). */
function contactLine(phone?: string | null, pref?: string | null): string {
  if (!phone) return "";
  const p = phone.trim();
  const call = `<a href="tel:${p}" style="color:#1a73e8;text-decoration:underline">Call</a>`;
  const text = `<a href="sms:${p}" style="color:#1a73e8;text-decoration:underline">Text</a>`;
  const both = pref === "call" ? call : pref === "text" ? text : `${call} or ${text}`;
  return `<br><b>Contact the vendor:</b> ${both} ${esc(p)}`;
}

/** Pickup details HTML block for order emails (window + location + maps + find + contact). */
function pickupHtml(o: OrderMail): string {
  const label = o.fulfillment === "delivery" ? "Delivery" : "Pickup";
  const where = o.pickupWhere || o.pickupInfo;
  const lines = [
    o.pickupWindow ? `<b>When:</b> ${esc(o.pickupWindow)}` : "",
    where ? `<b>Where:</b> ${esc(where)}${mapsAnchor(o.mapsUrl)}` : "",
    o.pickupFindMe ? `<b>How to find us:</b> ${esc(o.pickupFindMe)}` : "",
  ].filter(Boolean);
  const contact = contactLine(o.contactPhone, o.contactPref);
  if (!lines.length && !contact) return "";
  return `<br><br><b>${label} details</b><br>${lines.join("<br>")}${contact}`;
}

/** Branding block pulled from the OrderMail for the vendor-branded shell. */
function brandOf(o: OrderMail): Brand {
  return { storeName: o.storeName, logoUrl: o.logoUrl, accent: o.accent };
}

export function dropClosedEmail(o: {
  to: string;
  storeName: string;
  buyerFirst: string;
  dropTitle: string;
  orderLink: string;
  pickupWindow?: string | null;
  pickupWhere?: string | null;
  pickupNotes?: string | null;
  pickupFindMe?: string | null;
  mapsUrl?: string | null;
  contactPhone?: string | null;
  contactPref?: string | null;
  logoUrl?: string | null;
  accent?: string | null;
}): Mail {
  const pickup = [
    o.pickupWindow ? `<b>When:</b> ${esc(o.pickupWindow)}` : "",
    o.pickupWhere ? `<b>Where:</b> ${esc(o.pickupWhere)}${mapsAnchor(o.mapsUrl)}` : "",
    o.pickupFindMe ? `<b>How to find us:</b> ${esc(o.pickupFindMe)}` : "",
    o.pickupNotes ? `<b>Notes:</b> ${esc(o.pickupNotes)}` : "",
  ].filter(Boolean);
  const contact = contactLine(o.contactPhone, o.contactPref);
  return {
    to: o.to,
    subject: `The ${o.storeName} drop is over — your order is locked in`,
    html: vendorLayout(
      { storeName: o.storeName, logoUrl: o.logoUrl, accent: o.accent },
      "Your order is locked in 🔒",
      `Hi ${o.buyerFirst}, the <b>${o.dropTitle}</b> drop from <b>${o.storeName}</b> is now closed and your order is locked in.` +
        (pickup.length ? `<br><br><b>Pickup details</b><br>${pickup.join("<br>")}${contact}` : contact),
      { href: o.orderLink, label: "View your order" }
    ),
  };
}

/** Sent to every customer with an active order when the vendor checks in. */
export function vendorArrivedEmail(o: OrderMail & { dropTitle?: string }): Mail {
  const isPickup = (o.fulfillment ?? "pickup") === "pickup";
  return {
    to: o.to,
    subject: `${o.storeName} has arrived — ready for ${isPickup ? "pickup" : "handoff"} 📍`,
    html: vendorLayout(
      brandOf(o),
      `${esc(o.storeName)} is here! 📍`,
      `Hi ${o.buyerFirst}, <b>${esc(o.storeName)}</b> has arrived and is ready for you. Head over to collect your order.` +
        pickupHtml(o),
      { href: o.orderLink, label: "View your order & directions" }
    ),
  };
}

export function orderReceivedEmail(o: OrderMail): Mail {
  return {
    to: o.to,
    subject: `${o.storeName} got your order ✅`,
    html: vendorLayout(
      brandOf(o),
      "Order received!",
      `Hi ${o.buyerFirst}, thanks for ordering from <b>${o.storeName}</b>. We'll let you know the moment it's ready.` +
        pickupHtml(o),
      { href: o.orderLink, label: "View your order" }
    ),
  };
}

export function orderInProgressEmail(o: OrderMail): Mail {
  return {
    to: o.to,
    subject: `${o.storeName} is preparing your order 👩‍🍳`,
    html: vendorLayout(
      brandOf(o),
      "Your order is being prepared",
      `Hi ${o.buyerFirst}, <b>${o.storeName}</b> just started preparing your order. We'll email you the moment it's ready.` +
        (o.pickupInfo ? `<br><br><b>${o.fulfillment || "Pickup"}:</b> ${o.pickupInfo}` : ""),
      { href: o.orderLink, label: "View your order" }
    ),
  };
}

export function orderReadyEmail(o: OrderMail): Mail {
  const isPickup = (o.fulfillment ?? "pickup") === "pickup";
  return {
    to: o.to,
    subject: `Your ${o.storeName} order is ready${isPickup ? " for pickup" : ""} 🎉`,
    html: vendorLayout(
      brandOf(o),
      `Your order is ready${isPickup ? " for pickup" : ""}! 🎉`,
      `Hi ${o.buyerFirst}, your order from <b>${o.storeName}</b> is ready.` + pickupHtml(o),
      { href: o.orderLink, label: "View your order" }
    ),
  };
}

export function orderCompletedEmail(o: OrderMail): Mail {
  return {
    to: o.to,
    subject: `Thanks for your order from ${o.storeName}! 🙌`,
    html: vendorLayout(
      brandOf(o),
      "Order complete",
      `Hi ${o.buyerFirst}, thanks for ordering from <b>${o.storeName}</b>. We hope you loved it — see you at the next drop!`,
      { href: o.orderLink, label: "View your order" }
    ),
  };
}

export function orderCanceledEmail(o: OrderMail): Mail {
  return {
    to: o.to,
    subject: `Your ${o.storeName} order was canceled`,
    html: vendorLayout(
      brandOf(o),
      "Order canceled",
      `Hi ${o.buyerFirst}, your order from <b>${o.storeName}</b> has been canceled. If you have any questions, just reply to reach the maker.`,
      { href: o.orderLink, label: "View your order" }
    ),
  };
}

// ── Messaging ──────────────────────────────────────────────────────────────

/** Passwordless sign-in link for a customer opening their DropQ inbox. */
export function customerMagicLinkEmail(to: string, link: string): Mail {
  return {
    to,
    subject: "Your DropQ sign-in link",
    html: layout(
      "Open your messages",
      "Tap below to see your conversations with the businesses you order from. " +
        "This link works once and expires in 30 minutes. If you didn't request it, ignore this email.",
      { href: link, label: "Open my messages" }
    ),
  };
}

/**
 * Notifies a customer that a vendor messaged them *inside DropQ*. The email is
 * a pointer, never the message store — it carries a short preview and a link
 * back to the real conversation. Same shape an SMS will take later.
 */
export function newMessageEmail(o: {
  to: string;
  storeName: string;
  logoUrl?: string | null;
  accent?: string | null;
  preview: string;
  link: string;
  announcement?: boolean;
}): Mail {
  const kind = o.announcement ? "posted an announcement" : "sent you a message";
  return {
    to: o.to,
    subject: `${o.storeName} ${kind} on DropQ`,
    html: vendorLayout(
      { storeName: o.storeName, logoUrl: o.logoUrl, accent: o.accent },
      `${esc(o.storeName)} ${kind}`,
      `“${esc(o.preview)}”<br><br>Open DropQ to read it and reply.`,
      { href: o.link, label: "Read and reply" }
    ),
  };
}

/** Notifies a vendor that a customer replied. Plain DropQ branding. */
export function vendorNewMessageEmail(o: {
  to: string;
  customerName: string;
  preview: string;
  link: string;
}): Mail {
  return {
    to: o.to,
    subject: `${o.customerName} messaged you on DropQ`,
    html: layout(
      `${esc(o.customerName)} sent you a message`,
      `“${esc(o.preview)}”`,
      { href: o.link, label: "Reply in DropQ" }
    ),
  };
}
