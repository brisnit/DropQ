/**
 * Seed DropMeet with the San Diego County places supplied by the DropQ team.
 *
 *   node --env-file=.env prisma/seed-dropmeet-sd.mjs
 *
 * Rules this script holds to:
 *   • Names, addresses, descriptions and categories are used EXACTLY as given.
 *     Nothing is embellished.
 *   • Days of week are only recorded where the supplied description states one.
 *     Opening HOURS were not supplied, so no times are stored — a schedule with
 *     a day and null times renders as "Sundays · hours not listed".
 *   • Every address is geocoded and then validated against the real county
 *     polygon. A place that fails either step is written as a
 *     DropMeetCandidate for review instead of being published.
 *   • Entries with no address at all become candidates by definition.
 *   • Permanent venues with no recurrence (food halls, antique malls) are
 *     Locations only — not Markets. That matches the "map of Locations" model.
 *
 * Idempotent: re-running skips anything already present by name.
 */

import { PrismaClient } from "../app/generated/prisma/index.js";

const prisma = new PrismaClient();

const SOURCE = { sourceType: "manual_research", sourceName: "DropQ team list (operator-supplied)" };

// dayOfWeek: 0=Sun … 6=Sat. Only set where the supplied description says so.
const PLACES = [
  // ── Farmers markets ─────────────────────────────────────────────────────
  {
    name: "Little Italy Mercato Farmers' Market",
    address: "600 W Date St, San Diego, CA 92101",
    marketType: "farmers_market",
    locationType: "market",
    days: [3, 6], // "Operates Wednesdays and Saturdays"
    description:
      "San Diego's largest weekly certified farmers market with hundreds of vendors selling produce, flowers, baked goods, artisan foods, and handmade products. Operates Wednesdays and Saturdays.",
  },
  {
    name: "Hillcrest Farmers Market",
    address: "3960 Normal St, San Diego, CA 92103",
    marketType: "farmers_market",
    locationType: "market",
    days: [0], // "Sunday farmers markets"
    description:
      "One of the county's most popular Sunday farmers markets, known for fresh produce, prepared food, local artists, live music, and community atmosphere.",
  },
  {
    name: "Ocean Beach Certified Farmers Market",
    address: "4900 Newport Ave, San Diego, CA 92107",
    marketType: "farmers_market",
    locationType: "market",
    days: [3], // "Wednesday afternoon/evening"
    description:
      "Wednesday afternoon/evening certified farmers market featuring produce, food vendors, crafts, and live entertainment.",
  },
  {
    name: "North Park Thursday Market",
    // Cross-street only; ", San Diego, CA" appended purely to geocode the
    // neighbourhood the team filed it under. Flagged for verification.
    address: "North Park Way & 30th St, San Diego, CA",
    addressNeedsVerification: true,
    marketType: "farmers_market",
    locationType: "market",
    days: [4], // "Thursday Market"
    description:
      "Weekly evening neighborhood market combining farm vendors, artisan food, makers, and entertainment.",
  },
  {
    name: "La Mesa Farmers Market",
    address: "La Mesa Blvd, La Mesa, CA",
    addressNeedsVerification: true, // street without a number
    marketType: "farmers_market",
    locationType: "market",
    days: [5], // "Friday afternoon"
    description:
      "Popular Friday afternoon community market with produce, flowers, prepared food, and local businesses.",
  },
  {
    name: "Pacific Beach Tuesday Farmers Market",
    address: "4500 Bayard St, San Diego, CA 92109",
    marketType: "farmers_market",
    locationType: "market",
    days: [2],
    description:
      "One of San Diego's busiest weekday markets featuring produce, prepared food, crafts, and local vendors.",
  },
  {
    name: "Coronado Certified Farmers Market",
    address: "1201 First St, Coronado, CA",
    marketType: "farmers_market",
    locationType: "market",
    days: [2], // "Bayside Tuesday market"
    description: "Bayside Tuesday market with produce, specialty foods, flowers, and artisan vendors.",
  },
  {
    name: "Carlsbad State Street Farmers Market",
    address: "2900 State St, Carlsbad, CA",
    marketType: "farmers_market",
    locationType: "market",
    days: [3], // "Large Wednesday market"
    description: "Large Wednesday market serving North County.",
  },
  {
    name: "Vista Certified Farmers Market",
    address: "355 S Melrose Dr, Vista, CA",
    marketType: "farmers_market",
    locationType: "market",
    days: [6], // "Saturday farmers market"
    description: "Long-running Saturday farmers market with a strong produce selection.",
  },
  {
    name: "Poway Farmers Market",
    address: "14134 Midland Rd, Poway, CA",
    marketType: "farmers_market",
    locationType: "market",
    days: [6], // "Saturday morning market"
    description: "Popular Saturday morning market featuring local farms and artisan vendors.",
  },

  // ── Flea markets / swap meets ───────────────────────────────────────────
  {
    name: "Kobey's Swap Meet",
    address: "3500 Sports Arena Blvd, San Diego, CA 92110",
    marketType: "swap_meet",
    locationType: "market",
    days: [], // no day stated
    description:
      "One of the largest outdoor swap meets in Southern California with around 1,000 vendors selling antiques, collectibles, clothing, produce, tools, and household goods.",
  },
  {
    name: "Spring Valley Swap Meet",
    address: "6377 Quarry Rd, Spring Valley, CA 91977",
    marketType: "swap_meet",
    locationType: "market",
    days: [], // "Weekend" — not a specific day, so nothing is recorded
    description: "Weekend flea market with produce, clothing, food, and secondhand merchandise.",
  },
  {
    name: "South Bay Swap Meet",
    address: "2170 Coronado Ave, San Diego, CA 92154",
    marketType: "swap_meet",
    locationType: "market",
    days: [],
    description:
      "Large outdoor swap meet held at the South Bay Drive-In featuring hundreds of vendors.",
  },

  // ── Vintage ─────────────────────────────────────────────────────────────
  {
    name: "Silverlake Flea Encinitas",
    address: "459 S Coast Hwy 101, Encinitas, CA 92024",
    marketType: "vintage_market",
    locationType: "market",
    days: [],
    description:
      "Curated vintage clothing, handmade goods, art, jewelry, music, and food pop-up market.",
  },
  {
    name: "The Mart Vintage & Antique Mall",
    address: "6505 Mission Gorge Rd, San Diego, CA 92120",
    // Permanent venue, no recurrence — a Location, not a recurring Market.
    locationOnly: true,
    locationType: "retail",
    description:
      "Permanent multi-vendor vintage marketplace specializing in antiques, furniture, collectibles, and home décor.",
  },

  // ── Artisan ─────────────────────────────────────────────────────────────
  {
    name: "Gaslamp Artisan Market",
    address: "Fifth Avenue, Gaslamp Quarter, San Diego, CA",
    addressNeedsVerification: true, // street without a number
    marketType: "artisan_market",
    locationType: "market",
    days: [], // "Weekend" — not a specific day
    description:
      "Weekend open-air artisan market featuring handmade goods, jewelry, artwork, clothing, and gifts.",
  },

  // ── Food ────────────────────────────────────────────────────────────────
  {
    name: "Liberty Public Market",
    address: "2820 Historic Decatur Rd, San Diego, CA 92106",
    locationOnly: true, // permanent food hall, open daily
    locationType: "food_hall",
    description:
      "Indoor public food hall with dozens of local restaurants, specialty food vendors, bakeries, coffee, and craft beverages.",
  },
  {
    name: "Tuna Harbor Dockside Market",
    address: "598 Harbor Ln, San Diego, CA 92101",
    marketType: "food_market",
    locationType: "market",
    days: [], // "Weekly" — day not stated
    description:
      "Weekly waterfront seafood market where local fishermen sell directly to the public.",
  },
];

// No address supplied → candidate queue, never published.
const CANDIDATES = [
  {
    entityType: "market",
    rawName: "Day to Day Vintage Market",
    rawDescription:
      "Regular vintage market events centered around curated vintage clothing and local sellers.",
    reviewNotes: "No address supplied — needs a venue before it can be published.",
  },
  {
    entityType: "market",
    rawName: "Makers Arcade",
    rawDescription:
      "San Diego's premier curated makers market showcasing local artists, designers, food vendors, and handmade products.",
    reviewNotes:
      "No address supplied. Runs as a travelling event series — likely belongs as Events against specific venues rather than one recurring Market.",
  },
];

// ── Geo helpers (mirrors lib/dropmeet/geo.ts) ──────────────────────────────

function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat) {
      const crossX = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (lng < crossX) inside = !inside;
    }
  }
  return inside;
}

function pointInRings(lat, lng, rings) {
  let inside = false;
  for (const ring of rings) if (pointInRing(lat, lng, ring)) inside = !inside;
  return inside;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Nominatim, one request per second per their usage policy. */
async function geocode(query) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`,
    { headers: { "User-Agent": "DropQ/1.0 (https://www.drop-q.com)" } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const hit = Array.isArray(data) ? data[0] : null;
  if (!hit) return null;
  const a = hit.address ?? {};
  return {
    lat: parseFloat(hit.lat),
    lng: parseFloat(hit.lon),
    city: a.city || a.town || a.village || a.suburb || null,
    state: a.state === "California" ? "CA" : (a.state ?? null),
    postalCode: a.postcode ?? null,
  };
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

async function uniqueSlug(base, table) {
  for (let i = 0; i < 30; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const hit =
      table === "location"
        ? await prisma.location.findUnique({ where: { slug }, select: { id: true } })
        : await prisma.market.findUnique({ where: { slug }, select: { id: true } });
    if (!hit) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function main() {
  const region = await prisma.region.findUnique({ where: { slug: "san-diego-county" } });
  if (!region?.boundaryGeoJson) {
    throw new Error("No active region. Run `npm run db:seed-region` first.");
  }
  const geom = JSON.parse(region.boundaryGeoJson);
  const rings = geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();

  let published = 0;
  let queued = 0;
  let skipped = 0;
  const needsHours = [];
  const needsAddress = [];

  for (const place of PLACES) {
    const existing = await prisma.location.findFirst({
      where: { name: place.name },
      select: { id: true },
    });
    if (existing) {
      console.log(`  = ${place.name} — already present, skipped`);
      skipped++;
      continue;
    }

    process.stdout.write(`  · ${place.name} … `);
    await sleep(1100); // Nominatim: max 1 req/sec
    const geo = await geocode(place.address);

    if (!geo || !Number.isFinite(geo.lat)) {
      await prisma.dropMeetCandidate.create({
        data: {
          regionId: region.id,
          entityType: place.locationOnly ? "location" : "market",
          ...SOURCE,
          rawName: place.name,
          rawAddress: place.address,
          rawDescription: place.description,
          status: "needs_review",
          reviewNotes: "Address could not be geocoded — verify and add coordinates.",
        },
      });
      console.log("✗ geocode failed → candidate");
      queued++;
      continue;
    }

    if (!pointInRings(geo.lat, geo.lng, rings)) {
      await prisma.dropMeetCandidate.create({
        data: {
          regionId: region.id,
          entityType: place.locationOnly ? "location" : "market",
          ...SOURCE,
          rawName: place.name,
          rawAddress: place.address,
          rawDescription: place.description,
          latitude: geo.lat,
          longitude: geo.lng,
          insideRegion: false,
          status: "needs_review",
          reviewNotes: `Geocoded to ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)} — outside San Diego County. Verify the address.`,
        },
      });
      console.log("✗ outside county → candidate");
      queued++;
      continue;
    }

    const locSlug = await uniqueSlug(slugify(place.name), "location");
    const location = await prisma.location.create({
      data: {
        regionId: region.id,
        name: place.name,
        slug: locSlug,
        locationType: place.locationType,
        description: place.description,
        address: place.address,
        city: geo.city,
        state: geo.state ?? "CA",
        postalCode: geo.postalCode,
        latitude: geo.lat,
        longitude: geo.lng,
        status: "approved",
        // Operator-supplied, but the street data hasn't been field-checked.
        verificationStatus: place.addressNeedsVerification ? "needs_verification" : "verified",
        ...SOURCE,
        approvedAt: new Date(),
        lastVerifiedAt: new Date(),
        reviewNotes: place.addressNeedsVerification
          ? "Address supplied without a street number — confirm the exact pin."
          : null,
      },
    });

    if (place.addressNeedsVerification) needsAddress.push(place.name);

    if (!place.locationOnly) {
      const mktSlug = await uniqueSlug(slugify(place.name), "market");
      const market = await prisma.market.create({
        data: {
          regionId: region.id,
          locationId: location.id,
          name: place.name,
          slug: mktSlug,
          marketType: place.marketType,
          description: place.description,
          status: "approved",
          verificationStatus: place.addressNeedsVerification ? "needs_verification" : "verified",
          ...SOURCE,
          approvedAt: new Date(),
          lastVerifiedAt: new Date(),
          reviewNotes:
            place.days && place.days.length
              ? "Day of week from the supplied description. Opening hours not supplied — add them."
              : "No day or hours supplied — add a schedule so this appears in Today / This Weekend.",
        },
      });

      for (const d of place.days ?? []) {
        await prisma.marketSchedule.create({
          data: {
            marketId: market.id,
            recurrence: "weekly",
            dayOfWeek: d,
            startTime: null, // not supplied — deliberately not invented
            endTime: null,
            notes: "Hours not yet confirmed",
          },
        });
      }

      if (!place.days?.length) needsHours.push(`${place.name} (no day either)`);
      else needsHours.push(`${place.name} (${place.days.map((d) => DAY[d]).join("/")})`);
    }

    console.log(
      `✓ ${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}${place.locationOnly ? " (location only)" : ""}`
    );
    published++;
  }

  // Entries with no address at all.
  for (const c of CANDIDATES) {
    const existing = await prisma.dropMeetCandidate.findFirst({ where: { rawName: c.rawName } });
    if (existing) {
      console.log(`  = ${c.rawName} — candidate already present`);
      continue;
    }
    await prisma.dropMeetCandidate.create({
      data: { regionId: region.id, ...SOURCE, status: "needs_review", ...c },
    });
    console.log(`  ? ${c.rawName} → candidate (no address supplied)`);
    queued++;
  }

  console.log(`\n── Summary ──`);
  console.log(`Published : ${published}`);
  console.log(`Candidates: ${queued}`);
  console.log(`Skipped   : ${skipped}`);
  if (needsAddress.length) {
    console.log(`\nAddress needs confirming (no street number):`);
    needsAddress.forEach((n) => console.log(`  • ${n}`));
  }
  if (needsHours.length) {
    console.log(`\nOpening hours still needed (${needsHours.length}):`);
    needsHours.forEach((n) => console.log(`  • ${n}`));
  }
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
