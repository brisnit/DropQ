import "server-only";

/**
 * The caller's IP address, as far as it can be trusted.
 *
 * ── OBSERVED, NOT REASONED ────────────────────────────────────────────────
 *
 * Measured on 31 Aug 2026 against a real preview deployment of this project
 * (drop-9aj3qcgwu), with a temporary echo route since deleted. Three requests:
 * one ordinary, one sending `x-forwarded-for: 1.2.3.4`, one sending a full
 * chain `1.2.3.4, 5.6.7.8, 9.10.11.12`. In every case the application received:
 *
 *     x-vercel-forwarded-for   72.196.173.133
 *     x-forwarded-for          72.196.173.133
 *     x-real-ip                72.196.173.133
 *     x-vercel-proxied-for     72.196.173.133
 *     forwarded                for=72.196.173.133; …; sig=…
 *
 * The client's value was GONE. Not prepended, not appended, not preserved
 * anywhere — the header contained a single address, no comma, and the spoofed
 * bytes appeared in none of them. Vercel REPLACES these headers at the edge.
 * Spoofing `x-vercel-forwarded-for` and `x-vercel-proxied-for` directly was
 * equally ineffective.
 *
 * So the answer to the question this was built to settle — can an
 * unauthenticated client control the value below? — is NO, on this platform.
 *
 * ── WHY THIS ORDER ────────────────────────────────────────────────────────
 *
 *   1. `x-vercel-forwarded-for` — Vercel-generated, observed single-valued and
 *      observed unspoofable. Preferred precisely because it is the platform's
 *      own header rather than a general-purpose one we would have to reason
 *      about. On Vercel this is the only branch that ever runs.
 *   2. `x-forwarded-for`, rightmost entry. Only reachable off-Vercel — local
 *      development, or a future host. There, the header IS a chain a client can
 *      prepend to, and the rightmost entry is the one the nearest trusted proxy
 *      appended. This branch is a portability fallback, not the production path.
 *   3. `x-real-ip` — single-valued, conventionally proxy-set. Same caveat.
 *   4. `null`. No guess. Callers degrade to their other dimension rather than
 *      inventing a key; otherwise every anonymous caller shares one bucket and
 *      the first attacker locks out the world.
 *
 * `forwarded` carries a Vercel `sig=`, so it is signed and in principle the
 * strongest of the five — but verifying it needs the platform's key, and it
 * would only confirm what (1) already gives us. Not worth the dependency.
 */
export function clientIp(headers: Headers): string | null {
  // The Vercel-generated header. Observed authoritative; see above.
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const ip = normalize(first(vercel));
    if (ip) return ip;
  }

  // Off-platform fallback. Rightmost, because that is the entry a trusted
  // proxy appended rather than one the client wrote.
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const ip = normalize(last(forwarded));
    if (ip) return ip;
  }

  const real = headers.get("x-real-ip");
  if (real) {
    const ip = normalize(real);
    if (ip) return ip;
  }

  return null;
}

/**
 * The first entry. Correct for the Vercel header specifically: it was observed
 * to carry exactly one address, so first and last are the same value — and if
 * the platform ever did start appending, the first entry is the one it sets
 * for the original client rather than an intermediate hop.
 */
function first(value: string): string {
  return value.split(",")[0];
}

/** The last entry — see the note on the `x-forwarded-for` branch. */
function last(value: string): string | undefined {
  return value.split(",").pop();
}

/**
 * Trim, drop a port, and require something that at least looks like an address.
 *
 * Shape-checking matters here: the value becomes a rate-limit bucket key, and
 * anywhere this fallback path IS reachable, a caller who could put arbitrary
 * text in it could spray a million distinct keys and bloat the table.
 */
function normalize(value: string | undefined | null): string | null {
  if (!value) return null;
  let ip = value.trim();
  if (!ip) return null;

  // IPv4 with a port, e.g. 203.0.113.4:51234
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip);
  if (v4WithPort) ip = v4WithPort[1];

  // Bracketed IPv6, e.g. [2001:db8::1]:443
  const v6Bracketed = /^\[([0-9a-fA-F:.]+)\](?::\d+)?$/.exec(ip);
  if (v6Bracketed) ip = v6Bracketed[1];

  const isV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) &&
    ip.split(".").every((o) => Number(o) <= 255);
  const isV6 = /^[0-9a-fA-F:]+$/.test(ip) && ip.includes(":") && ip.length <= 45;

  return isV4 || isV6 ? ip.toLowerCase() : null;
}
