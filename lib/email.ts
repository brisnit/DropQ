import "server-only";

const RESEND_URL = "https://api.resend.com/emails";

type Mail = { to: string; subject: string; html: string };

/**
 * Send an email via Resend if RESEND_API_KEY is set; otherwise log it to the
 * server console (dev mode) so flows work with zero paid services.
 */
export async function sendEmail({ to, subject, html }: Mail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "DropQ <onboarding@resend.dev>";

  if (!key) {
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log(
      `\n──────── 📧 EMAIL (dev mode — set RESEND_API_KEY to send for real) ────────\n` +
        `To:      ${to}\nSubject: ${subject}\n${text}\n` +
        `────────────────────────────────────────────────────────────────────────\n`
    );
    return;
  }

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) console.error("Resend email failed:", res.status, await res.text());
  } catch (e) {
    console.error("Resend email error:", e);
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
};

export function orderReceivedEmail(o: OrderMail): Mail {
  return {
    to: o.to,
    subject: `${o.storeName} got your order ✅`,
    html: layout(
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
    html: layout(
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
    html: layout(
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
    html: layout(
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
    html: layout(
      "Order canceled",
      `Hi ${o.buyerFirst}, your order from <b>${o.storeName}</b> has been canceled. If you have any questions, just reply to reach the maker.`,
      { href: o.orderLink, label: "View your order" }
    ),
  };
}
