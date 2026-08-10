// Deriving a best-effort rate-limit key from the caller's claimed address.
//
// READ THIS BEFORE RELYING ON THE RESULT: on Azure Functions Consumption with
// no trusted proxy in front, the caller's real address CANNOT be established
// from a request. This function returns a key that is useful for separating
// honest callers from each other, and useless against anyone who doesn't want
// to be identified. The control that actually bounds abuse is the global rate
// limit in rateLimiter.ts, which depends on no caller-supplied value.
//
// This was established empirically against the live deployment, after two
// wrong implementations (see the Milestone 4 engineering log):
//
//   * Send no headers -> the limit works. So Azure populates X-Forwarded-For
//     when the client sends none.
//   * Send `X-Forwarded-For: 1.2.3.4` -> a rate-limited caller is unblocked,
//     whether the code reads the first entry or the last. So Azure neither
//     prepends nor appends the real address; it passes a caller-supplied
//     header through untouched.
//   * Send `X-Azure-SocketIP` / `X-Azure-ClientIP` -> also honoured, also
//     forgeable. Those are Azure Front Door headers; with no Front Door in
//     front of this app, nothing sets them and nothing strips them.
//
// The generalisable lesson, which cost two deploys to learn properly: a
// request header is only trustworthy if a hop you control is known to
// OVERWRITE it. Not "sets it", not "usually adds it" — overwrites it. Absent
// that, choosing a different header or a different entry in the list is
// rearranging attacker-controlled data, which is what both earlier attempts
// did.
//
// This becomes trustworthy at Milestone 6, if the frontend is served through
// Static Web Apps' linked-backend pattern with access restrictions on the
// Function App — at which point there IS a trusted hop, and this function
// should be revisited rather than left as-is.

const FALLBACK_KEY = "ip:unknown";

export type ClientAddressHeaders = {
  forwardedFor?: string | null;
};

export function resolveRateLimitKey(headers: ClientAddressHeaders): string {
  // First entry only, and only as a hint. The X-Azure-* headers are
  // deliberately NOT consulted: they are equally forgeable here, and reading
  // them would imply a trust that doesn't exist.
  const originating = headers.forwardedFor
    ?.split(",")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  if (!originating) return FALLBACK_KEY;

  return `ip:${stripPort(originating)}`;
}

function stripPort(address: string): string {
  // Azure includes a source port ("203.0.113.7:53124"), which must go: left
  // in, the same caller gets a different key on every connection and the
  // per-caller limit never applies to anyone.
  //
  // IPv6 arrives bracketed when a port is present ("[2001:db8::1]:443"); an
  // unbracketed IPv6 address contains colons that are not a port separator.
  const bracketed = address.match(/^\[(.+)\]:\d+$/);
  if (bracketed) return bracketed[1];

  const colonCount = (address.match(/:/g) ?? []).length;
  if (colonCount === 1) return address.split(":")[0];

  return address;
}
