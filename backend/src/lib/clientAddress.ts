// Deriving a rate-limit key from the caller's address.
//
// This is the part of the rate limiter most likely to be got wrong quietly, and
// it was: the first implementation trusted the LAST X-Forwarded-For entry, on
// the reasoning that Azure appends the real client address to whatever arrived.
// Tested against the real deployment, that turned out to be false — a caller
// who was already rate-limited got straight back to HTTP 200 by sending
// `X-Forwarded-For: 1.2.3.4`, and again with a different value, and again. The
// limiter was bypassable by anyone who thought to try. See the Milestone 4
// engineering log.
//
// The lesson, and the reason this file's order of preference looks the way it
// does: X-Forwarded-For is a request header, and every request header is
// attacker-controlled unless a trusted hop is known to overwrite it. Reasoning
// about which entry a platform "should" add is guesswork. Preferring headers
// the platform derives from the TCP connection removes the guess — a caller
// cannot influence the socket they connected from.
//
// Order of trust:
//   1. x-azure-socketip  — the peer address of the TCP connection as Azure's
//      front end saw it. Not derived from anything the caller sent.
//   2. x-azure-clientip  — Azure's own determination of the originating client.
//   3. x-forwarded-for, FIRST entry — the conventional position for the
//      originating client. Kept only as a fallback, and note it is the weakest
//      of the three precisely because it is caller-influenced.
//   4. a fixed key — a shared bucket rather than a free pass. If the address
//      can't be determined, unattributable traffic gets rate-limited together,
//      which fails toward protecting the endpoint rather than exempting it.

const FALLBACK_KEY = "ip:unknown";

export type ClientAddressHeaders = {
  socketIp?: string | null;
  clientIp?: string | null;
  forwardedFor?: string | null;
};

export function resolveRateLimitKey(headers: ClientAddressHeaders): string {
  const platformAddress = firstNonEmpty(headers.socketIp, headers.clientIp);
  if (platformAddress) return `ip:${stripPort(platformAddress.trim())}`;

  const forwardedFor = headers.forwardedFor?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  const originating = forwardedFor[0];
  if (originating) return `ip:${stripPort(originating)}`;

  return FALLBACK_KEY;
}

function firstNonEmpty(...values: (string | null | undefined)[]): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0) ?? undefined;
}

function stripPort(address: string): string {
  // Azure includes a source port on some of these ("203.0.113.7:53124"), which
  // must go: left in, the same caller gets a different key on every connection,
  // and the limit never applies to anyone.
  //
  // IPv6 arrives bracketed when a port is present ("[2001:db8::1]:443"); an
  // unbracketed IPv6 address contains colons that are not a port separator.
  const bracketed = address.match(/^\[(.+)\]:\d+$/);
  if (bracketed) return bracketed[1];

  const colonCount = (address.match(/:/g) ?? []).length;
  if (colonCount === 1) return address.split(":")[0];

  return address;
}
