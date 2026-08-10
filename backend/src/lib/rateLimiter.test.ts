import { describe, it, expect, vi } from "vitest";
import {
  checkRateLimit,
  checkRateLimits,
  GLOBAL_RATE_LIMIT_KEY,
  GLOBAL_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_MAX_REQUESTS,
  type RateLimitDeps,
} from "./rateLimiter";
import { resolveRateLimitKey } from "./clientAddress";

function makeDeps(existingCount: number | undefined, now = new Date("2026-08-10T12:00:30Z")): RateLimitDeps {
  const upsert = vi.fn().mockResolvedValue({});
  return {
    container: {
      item: vi.fn().mockReturnValue({
        read: vi.fn().mockResolvedValue({
          resource: existingCount === undefined ? undefined : { count: existingCount },
        }),
      }),
      items: { upsert },
    } as unknown as RateLimitDeps["container"],
    now: () => now,
  };
}

describe("checkRateLimit", () => {
  it("allows a first request in a fresh window", async () => {
    const result = await checkRateLimit("ip:203.0.113.7", makeDeps(undefined));
    expect(result.allowed).toBe(true);
  });

  it("allows a request below the limit", async () => {
    const result = await checkRateLimit("ip:203.0.113.7", makeDeps(RATE_LIMIT_MAX_REQUESTS - 1));
    expect(result.allowed).toBe(true);
  });

  it("blocks once the limit is reached", async () => {
    const result = await checkRateLimit("ip:203.0.113.7", makeDeps(RATE_LIMIT_MAX_REQUESTS));
    expect(result.allowed).toBe(false);
  });

  it("doesn't write a counter for a blocked request", async () => {
    const deps = makeDeps(RATE_LIMIT_MAX_REQUESTS);
    await checkRateLimit("ip:203.0.113.7", deps);
    expect(deps.container.items.upsert).not.toHaveBeenCalled();
  });

  it("reports how long until the window resets", async () => {
    // 12:00:30 sits 30s into a 60s window, so the next one starts in 30s.
    const result = await checkRateLimit("ip:203.0.113.7", makeDeps(1));
    expect(result.retryAfterSeconds).toBe(30);
  });

  it("sets a ttl so counters delete themselves, with no cleanup job", async () => {
    const deps = makeDeps(undefined);
    await checkRateLimit("ip:203.0.113.7", deps);
    const written = (deps.container.items.upsert as any).mock.calls[0][0];
    expect(written.ttl).toBeGreaterThan(0);
    expect(written.schemaVersion).toBe(1);
  });
});

// The global limit is the control that actually holds, because its key comes
// from nothing the caller supplies. These assert the property that makes it
// worth having, not just that a counter counts.
describe("checkRateLimits", () => {
  function makeCountingDeps(counts: Record<string, number>): RateLimitDeps {
    return {
      container: {
        item: vi.fn((id: string) => ({
          read: vi.fn().mockResolvedValue({
            resource: counts[id.split(":").slice(0, -1).join(":")] === undefined
              ? undefined
              : { count: counts[id.split(":").slice(0, -1).join(":")] },
          }),
        })),
        items: { upsert: vi.fn().mockResolvedValue({}) },
      } as unknown as RateLimitDeps["container"],
      now: () => new Date("2026-08-10T12:00:30Z"),
    };
  }

  it("allows a caller who is under both limits", async () => {
    const result = await checkRateLimits("ip:203.0.113.7", makeCountingDeps({}));
    expect(result.allowed).toBe(true);
  });

  it("blocks once the global limit is reached, whatever the caller key", async () => {
    const deps = makeCountingDeps({ [GLOBAL_RATE_LIMIT_KEY]: GLOBAL_RATE_LIMIT_MAX_REQUESTS });
    const result = await checkRateLimits("ip:203.0.113.7", deps);
    expect(result.allowed).toBe(false);
  });

  // The bypass that shipped: a caller who rotates a forged address gets a fresh
  // per-caller bucket every time. The global limit has to catch them anyway.
  it("still blocks a caller inventing a brand-new address each request", async () => {
    const deps = makeCountingDeps({ [GLOBAL_RATE_LIMIT_KEY]: GLOBAL_RATE_LIMIT_MAX_REQUESTS });
    for (const forged of ["ip:1.2.3.4", "ip:9.9.9.9", "ip:5.5.5.5"]) {
      const result = await checkRateLimits(forged, deps);
      expect(result.allowed).toBe(false);
    }
  });

  it("blocks a single caller over the per-caller limit while the global budget is fine", async () => {
    const deps = makeCountingDeps({ "ip:203.0.113.7": RATE_LIMIT_MAX_REQUESTS });
    const result = await checkRateLimits("ip:203.0.113.7", deps);
    expect(result.allowed).toBe(false);
  });
});

describe("resolveRateLimitKey", () => {
  // Note what these do NOT claim. Established empirically against the live
  // deployment: Azure passes a caller-supplied X-Forwarded-For through
  // untouched, so this key is a hint for separating honest callers, not a
  // security boundary. The tests assert parsing, which is all this function is
  // responsible for; the security property lives in the global limit above.
  it("uses the first entry, the conventional originating-client position", () => {
    expect(resolveRateLimitKey({ forwardedFor: "203.0.113.7:53124, 10.0.0.1" })).toBe("ip:203.0.113.7");
  });

  it("strips the source port so one caller keeps one key", () => {
    expect(resolveRateLimitKey({ forwardedFor: "203.0.113.7:53124" })).toBe("ip:203.0.113.7");
    expect(resolveRateLimitKey({ forwardedFor: "203.0.113.7:60001" })).toBe("ip:203.0.113.7");
  });

  it("handles bracketed IPv6 with a port", () => {
    expect(resolveRateLimitKey({ forwardedFor: "[2001:db8::1]:443" })).toBe("ip:2001:db8::1");
  });

  it("leaves bare IPv6 intact rather than mistaking a colon for a port", () => {
    expect(resolveRateLimitKey({ forwardedFor: "2001:db8::1" })).toBe("ip:2001:db8::1");
  });

  it("falls back to a shared key when no address is present", () => {
    expect(resolveRateLimitKey({})).toBe("ip:unknown");
    expect(resolveRateLimitKey({ forwardedFor: "" })).toBe("ip:unknown");
  });
});
