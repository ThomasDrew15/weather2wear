// Deriving a rate-limit key from the caller's address.
//
// This is the part of the rate limiter most likely to be got wrong quietly, so
// the reasoning is written down rather than implied.
//
// X-Forwarded-For is a *client-settable* header. A caller can send their own,
// and Azure's front end appends the real client address to whatever arrived
// rather than replacing it. So the LAST entry is the one Azure added and the
// only one worth trusting; the earlier entries are caller-controlled and would
// let anyone mint unlimited rate-limit keys by rotating a fake value.
//
// Taking the first entry is the conventional advice for a load balancer you
// operate yourself, and is exactly the wrong choice here. Verified against the
// real deployment rather than assumed — see the Milestone 4 engineering log.
//
// Azure includes a source port (e.g. "203.0.113.7:53124"), which is stripped:
// leaving it in would give the same caller a different key on every connection.

const FALLBACK_KEY = "ip:unknown";

export function resolveRateLimitKey(forwardedForHeader: string | null | undefined): string {
  if (!forwardedForHeader) return FALLBACK_KEY;

  const entries = forwardedForHeader
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const azureAppended = entries.at(-1);
  if (!azureAppended) return FALLBACK_KEY;

  return `ip:${stripPort(azureAppended)}`;
}

function stripPort(address: string): string {
  // IPv6 arrives bracketed when a port is present ("[2001:db8::1]:443"); an
  // unbracketed IPv6 address contains colons that are not a port separator.
  const bracketed = address.match(/^\[(.+)\]:\d+$/);
  if (bracketed) return bracketed[1];

  const colonCount = (address.match(/:/g) ?? []).length;
  if (colonCount === 1) return address.split(":")[0];

  return address;
}
