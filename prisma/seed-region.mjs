/**
 * Seed (or refresh) a DropMeet region with an authoritative county boundary.
 *
 * The polygon comes from US Census TIGERweb, the same source that defines the
 * legal county line — not a hand-drawn shape and not a bounding box. Provenance
 * is stored alongside it so we can tell where the geometry came from and when.
 *
 *   node --env-file=.env prisma/seed-region.mjs
 *
 * Adding a county later is one entry in REGIONS below plus a re-run; no code
 * changes anywhere else.
 */

import { PrismaClient } from "../app/generated/prisma/index.js";

const prisma = new PrismaClient();

const TIGERWEB =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query";

const REGIONS = [
  {
    slug: "san-diego-county",
    name: "San Diego County",
    stateFips: "06",
    countyFips: "073",
    // Downtown San Diego — a sensible opening viewport for the county.
    center: { lat: 32.7157, lng: -117.1611 },
    zoom: 9.2,
    active: true,
  },
  // Future: { slug: "orange-county", stateFips: "06", countyFips: "059", active: false }, …
];

async function fetchBoundary(stateFips, countyFips) {
  const url =
    `${TIGERWEB}?where=STATE%3D%27${stateFips}%27+AND+COUNTY%3D%27${countyFips}%27` +
    `&outFields=NAME,GEOID&outSR=4326&f=geojson`;

  const res = await fetch(url, { headers: { "User-Agent": "DropQ/1.0 (https://www.drop-q.com)" } });
  if (!res.ok) throw new Error(`TIGERweb responded ${res.status}`);

  const json = await res.json();
  const feature = json?.features?.[0];
  if (!feature?.geometry) throw new Error("TIGERweb returned no geometry");
  return feature;
}

function bboxOf(geometry) {
  const rings =
    geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
  let minLat = 90;
  let minLng = 180;
  let maxLat = -90;
  let maxLng = -180;
  let points = 0;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      points++;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  return { minLat, minLng, maxLat, maxLng, points };
}

async function main() {
  for (const r of REGIONS) {
    process.stdout.write(`${r.name}: fetching boundary… `);
    const feature = await fetchBoundary(r.stateFips, r.countyFips);
    const bbox = bboxOf(feature.geometry);
    console.log(`${bbox.points} vertices, GEOID ${feature.properties?.GEOID ?? "?"}`);

    const data = {
      name: r.name,
      boundaryGeoJson: JSON.stringify(feature.geometry),
      boundarySource: `US Census TIGERweb State_County (GEOID ${feature.properties?.GEOID ?? ""})`,
      boundaryFetchedAt: new Date(),
      minLatitude: bbox.minLat,
      minLongitude: bbox.minLng,
      maxLatitude: bbox.maxLat,
      maxLongitude: bbox.maxLng,
      defaultCenterLatitude: r.center.lat,
      defaultCenterLongitude: r.center.lng,
      defaultZoom: r.zoom,
      active: r.active,
    };

    await prisma.region.upsert({
      where: { slug: r.slug },
      create: { slug: r.slug, ...data },
      update: data,
    });

    console.log(
      `  ✓ ${r.slug} — bbox ${bbox.minLat.toFixed(3)},${bbox.minLng.toFixed(3)} → ` +
        `${bbox.maxLat.toFixed(3)},${bbox.maxLng.toFixed(3)} · active=${r.active}`
    );
  }
}

main()
  .catch((e) => {
    console.error("Region seed failed:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
