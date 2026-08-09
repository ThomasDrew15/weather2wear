import { describe, it, expect, vi } from "vitest";
import { checkRateLimit, RATE_LIMIT_MAX_REQUESTS, type RateLimitDeps } from "./rateLimiter";
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

describe("resolveRateLimitKey", () => {
  // The security-relevant case: X-Forwarded-For is client-settable, and Azure
  // appends the real address rather than replacing what arrived. Trusting the
  // first entry would let a caller mint unlimited keys with a fake value.
  it("uses the last entry, which is the one Azure appended", () => {
    expect(resolveRateLimitKey("1.2.3.4, 203.0.113.7:53124")).toBe("ip:203.0.113.7");
  });

  it("ignores a spoofed leading entry entirely", () => {
    const spoofed = resolveRateLimitKey("attacker-chosen-value, 203.0.113.7:1234");
    const honest = resolveRateLimitKey("203.0.113.7:1234");
    expect(spoofed).toBe(honest);
  });

  it("strips the source port so one caller keeps one key", () => {
    expect(resolveRateLimitKey("203.0.113.7:53124")).toBe("ip:203.0.113.7");
    expect(resolveRateLimitKey("203.0.113.7:60001")).toBe("ip:203.0.113.7");
  });

  it("handles bracketed IPv6 with a port", () => {
    expect(resolveRateLimitKey("[2001:db8::1]:443")).toBe("ip:2001:db8::1");
  });

  it("leaves bare IPv6 intact rather than mistaking a colon for a port", () => {
    expect(resolveRateLimitKey("2001:db8::1")).toBe("ip:2001:db8::1");
  });

  it("falls back to a fixed key when the header is absent", () => {
    expect(resolveRateLimitKey(null)).toBe("ip:unknown");
    expect(resolveRateLimitKey("")).toBe("ip:unknown");
  });
});
