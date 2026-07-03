import "server-only";

const RESEND_URL = "https://api.resend.com/emails";

type Mail = { to: string; subject: string; html: string };

export type SendResult = {
  ok: boolean;
  skipped?: boolean; // no API key — logged to console instead of sent
  status?: number;
  error?: string;
};

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

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
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
      <div style="background:#1a1a1a;padding:20px 24px;color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.01em">Drop<span style="color:#ffc500">Q</span></div>
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
        <a href="${cta.href}" style="display:inline-block;background:${accent};color:${onAccent};text-decoration:none;font-weight:600;padding:12px 22px;border-radius:12px">${cta.label}</a>
        <p style="font-size:12px;color:#6b6b6b;margin:22px 0 0">If the button doesn't work, copy this link:<br><span style="color:#6b6b6b;word-break:break-all">${cta.href}</span></p>
      </div>
    </div>
    <p style="text-align:center;color:#9aa0a6;font-size:12px;margin-top:16px">
      Powered by <a href="https://www.drop-q.com" style="color:#9aa0a6;text-decoration:underline">DropQ</a>
      &nbsp;·&nbsp; Want a store like this? <a href="https://www.drop-q.com" style="color:#9aa0a6;text-decoration:underline">Start free →</a>
    </p>
  </div>`;
}

export function salesRepInviteEmail(o: {
  name: string;
  email: string;
  referralCode: string;
  signupUrl: string;
  accountUrl: string;
}): Mail {
  return {
    to: o.email,
    subject: "You've been invited to sell with DropQ",
    html: layout(
      `Hi ${o.name},`,
      `You've been invited to earn commission with DropQ.<br><br>` +
        `Your DropQ referral code is: <b>${o.referralCode}</b><br>` +
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

type OrderMail = {
  to: string;
  storeName: string;
  buyerFirst: string;
  orderLink: string;
  pickupInfo?: string | null;
  fulfillment?: string;
  logoUrl?: string | null;
  accent?: string | null;
};

/** Branding block pulled from the OrderMail for the vendor-branded shell. */
function brandOf(o: OrderMail): Brand {
  return { storeName: o.storeName, logoUrl: o.logoUrl, accent: o.accent };
}

export function orderReceivedEmail(o: OrderMail): Mail {
  return {
    to: o.to,
    subject: `${o.storeName} got your order ✅`,
    html: vendorLayout(
      brandOf(o),
      "Order received!",
      `Hi ${o.buyerFirst}, thanks for ordering from <b>${o.storeName}</b>. We'll let you know the moment it's ready.` +
        (o.pickupInfo ? `<br><br><b>${o.fulfillment || "Pickup"}:</b> ${o.pickupInfo}` : ""),
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
      `Hi ${o.buyerFirst}, your order from <b>${o.storeName}</b> is ready.` +
        (o.pickupInfo
          ? `<br><br><b>${isPickup ? "Pickup" : o.fulfillment}:</b> ${o.pickupInfo}`
          : ""),
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
