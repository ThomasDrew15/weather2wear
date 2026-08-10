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
  // The security-relevant behaviour, and the one the first implementation got
  // wrong: X-Forwarded-For is a request header, so it is caller-controlled.
  // Platform headers derived from the TCP connection are not, so they win.
  it("prefers the platform socket address over anything the caller sent", () => {
    const key = resolveRateLimitKey({
      socketIp: "203.0.113.7:53124",
      forwardedFor: "1.2.3.4",
    });
    expect(key).toBe("ip:203.0.113.7");
  });

  it("gives the same key however the caller forges X-Forwarded-For", () => {
    const honest = resolveRateLimitKey({ socketIp: "203.0.113.7" });
    const forged = resolveRateLimitKey({ socketIp: "203.0.113.7", forwardedFor: "1.2.3.4, 9.9.9.9" });
    const forgedAgain = resolveRateLimitKey({ socketIp: "203.0.113.7", forwardedFor: "5.5.5.5:1234" });
    expect(forged).toBe(honest);
    expect(forgedAgain).toBe(honest);
  });

  it("falls back to the client-ip header before touching X-Forwarded-For", () => {
    const key = resolveRateLimitKey({ clientIp: "203.0.113.7", forwardedFor: "1.2.3.4" });
    expect(key).toBe("ip:203.0.113.7");
  });

  it("uses the first X-Forwarded-For entry when no platform header is present", () => {
    expect(resolveRateLimitKey({ forwardedFor: "203.0.113.7:53124, 10.0.0.1" })).toBe("ip:203.0.113.7");
  });

  it("strips the source port so one caller keeps one key", () => {
    expect(resolveRateLimitKey({ socketIp: "203.0.113.7:53124" })).toBe("ip:203.0.113.7");
    expect(resolveRateLimitKey({ socketIp: "203.0.113.7:60001" })).toBe("ip:203.0.113.7");
  });

  it("handles bracketed IPv6 with a port", () => {
    expect(resolveRateLimitKey({ socketIp: "[2001:db8::1]:443" })).toBe("ip:2001:db8::1");
  });

  it("leaves bare IPv6 intact rather than mistaking a colon for a port", () => {
    expect(resolveRateLimitKey({ socketIp: "2001:db8::1" })).toBe("ip:2001:db8::1");
  });

  // Not a free pass: unattributable traffic shares one bucket, so it is still
  // rate-limited rather than exempt.
  it("falls back to a shared key when no address can be determined", () => {
    expect(resolveRateLimitKey({})).toBe("ip:unknown");
    expect(resolveRateLimitKey({ socketIp: "", forwardedFor: "" })).toBe("ip:unknown");
  });
});
