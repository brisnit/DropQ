/**
 * Every Help screenshot DropQ ships, as data.
 *
 * Adding an image is a change to this list, not a change to a script. Each
 * entry names the article it illustrates, the product state it needs, the route
 * to visit, and — where one exists — the GUIDANCE ANCHOR to highlight.
 *
 * Reusing `data-guidance-anchor` is deliberate: the element a coachmark points
 * at in the product and the element a screenshot highlights in the docs resolve
 * through the same registry, so they cannot drift apart.
 *
 * MOBILE FIRST. Most DropQ vendors work from a phone, so 390×844 is the default
 * and a shot only opts into desktop when the screen genuinely needs the width.
 */

/** Scenes are applied in this order; shots run within their scene. */
export const SCENES = ["new", "draft", "live"];

export const SHOTS = [
  /* ---------------- Getting started with DropQ ---------------- */
  {
    id: "getting-started-dashboard",
    article: "first-week",
    scene: "new",
    route: "/dashboard",
    anchor: "dash.checklist",
    marker: 1,
    caption: "Your dashboard, with the checklist that tracks itself.",
  },
  {
    id: "getting-started-new-drop",
    article: "first-week",
    scene: "new",
    route: "/dashboard",
    anchor: "dash.newDrop",
    marker: 2,
    caption: "Everything starts with a drop.",
  },
  {
    id: "getting-started-help",
    article: "first-week",
    scene: "new",
    route: "/dashboard",
    selector: '[aria-label="Help"]',
    marker: 3,
    caption: "Help is in the header on every screen.",
  },

  /* ---------------- Creating your first Drop ---------------- */
  {
    id: "create-drop-choose-type",
    article: "create-your-first-drop",
    scene: "new",
    route: "/dashboard/drops",
    anchor: "drops.modePick",
    marker: 1,
    caption: "Choose how you're selling. You pick this once.",
  },
  {
    id: "create-drop-details",
    article: "create-your-first-drop",
    scene: "new",
    route: "/dashboard/drops/new",
    selector: 'input[name="title"]',
    marker: 2,
    caption: "Title and description — this is what customers read.",
  },
  {
    id: "create-drop-fulfilment",
    article: "create-your-first-drop",
    scene: "new",
    route: "/dashboard/drops/new",
    selector: 'select[name="fulfillment"]',
    marker: 3,
    caption: "How customers get it, and where.",
  },
  {
    id: "create-drop-save",
    article: "create-your-first-drop",
    scene: "new",
    route: "/dashboard/drops/new",
    anchor: "editor.saveBar",
    marker: 4,
    caption: "Save as a draft, or publish when Stripe is ready.",
  },

  /* ---------------- Adding items ---------------- */
  {
    id: "add-items-row",
    article: "add-items",
    scene: "new",
    route: "/dashboard/drops/new",
    selector: 'input[name="p_name"]',
    marker: 1,
    caption: "Each item needs a name and a price.",
  },
  {
    id: "add-items-inventory",
    article: "add-items",
    scene: "new",
    route: "/dashboard/drops/new",
    anchor: "editor.inventory",
    marker: 2,
    caption: "How many you're selling in THIS drop.",
  },
  {
    id: "add-items-result",
    article: "add-items",
    // The LIVE scene, not the draft one: the whole point of this image is the
    // sold-against-quantity bar, and in a draft every bar reads 0.
    scene: "live",
    route: "/dashboard/drops/:dropId",
    selectorText: "Menu",
    marker: 3,
    caption: "Your items, with sell-through as orders arrive.",
  },

  /* ---------------- Choosing your dates ---------------- */
  {
    id: "dates-order-window",
    article: "how-drop-dates-work",
    scene: "new",
    route: "/dashboard/drops/new",
    anchor: "editor.orderWindow",
    marker: 1,
    caption: "Window 1 — when customers can order.",
  },
  {
    id: "dates-pickup-window",
    article: "how-drop-dates-work",
    scene: "new",
    route: "/dashboard/drops/new",
    anchor: "editor.pickupWindow",
    marker: 2,
    caption: "Window 2 — when they collect. Starts after ordering closes.",
  },
  {
    id: "dates-summary",
    article: "how-drop-dates-work",
    scene: "draft",
    route: "/dashboard/drops/:dropId",
    selectorText: "Order window",
    marker: 3,
    caption: "Both windows, as they read once the drop exists.",
  },

  /* ---------------- Connecting Stripe ---------------- */
  {
    id: "stripe-payments-page",
    article: "connect-stripe",
    scene: "new",
    route: "/dashboard/payments",
    // By role, not by text: the page explains the button before it shows it.
    role: "button",
    roleName: "Connect with Stripe",
    marker: 1,
    caption: "Payments → Connect with Stripe.",
  },
  {
    id: "stripe-handoff",
    article: "connect-stripe",
    scene: "new",
    route: "/dashboard/payments",
    selectorText: "securely redirected",
    marker: 2,
    caption: "DropQ hands you to Stripe. The rest happens on Stripe's site.",
  },
  {
    id: "stripe-connected",
    article: "connect-stripe",
    scene: "draft",
    route: "/dashboard/payments",
    selectorText: "Payments are connected",
    marker: 3,
    caption: "Once Stripe can take charges, you can publish.",
  },

  /* ---------------- Publishing and sharing ---------------- */
  {
    id: "publish-button",
    article: "publish-a-drop",
    scene: "draft",
    route: "/dashboard/drops/:dropId",
    anchor: "drop.publish",
    marker: 1,
    caption: "Publish puts the drop on your storefront.",
  },
  {
    id: "publish-live-state",
    article: "publish-a-drop",
    scene: "live",
    route: "/dashboard/drops/:dropId",
    selectorText: "Order window",
    marker: 2,
    caption: "Live, and counting down to the close time.",
  },
  {
    id: "publish-share-link",
    article: "publish-a-drop",
    scene: "live",
    route: "/dashboard/drops/:dropId",
    selectorText: "Copy link",
    marker: 3,
    caption: "The link for this drop. Post it anywhere.",
  },
  {
    id: "publish-qr",
    article: "publish-a-drop",
    scene: "live",
    route: "/dashboard/drops/:dropId",
    anchor: "drop.qr",
    marker: 4,
    caption: "This drop's own QR code — print it, put it on the table.",
  },
];

/** Article slugs that carry screenshots. Used by the check mode. */
export const ILLUSTRATED = [...new Set(SHOTS.map((s) => s.article))];
