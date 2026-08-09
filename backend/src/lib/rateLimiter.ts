import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";

// Fixed-window rate limiter backed by the rateLimits Cosmos container.
//
// Cosmos rather than an in-memory Map because Consumption scales out and
// recycles instances: a per-instance counter resets on every cold start and
// counts separately per instance, which makes the limit approximate in a way
// you couldn't honestly document. This reuses infrastructure that already
// exists and was proven end-to-end by Milestone 3's smoke test — no new
// service, no always-on cost.
//
// Fixed window (rather than sliding) is the deliberate simple choice: one point
// read plus one write per request, no history to store or scan. Its known
// weakness is burst tolerance at a window boundary — up to 2x the limit across
// two adjacent windows. That's acceptable for a cost control whose job is
// stopping sustained hammering, not enforcing a precise SLA.

const DATABASE_NAME = "woa";
const RATE_LIMITS_CONTAINER_NAME = "rateLimits";

export const RATE_LIMIT_MAX_REQUESTS = 10;
export const RATE_LIMIT_WINDOW_SECONDS = 60;

let cachedContainer: Container | undefined;

function getRateLimitsContainer(): Container {
  if (cachedContainer) return cachedContainer;
  const endpoint = process.env.COSMOS_ACCOUNT_ENDPOINT;
  if (!endpoint) throw new Error("COSMOS_ACCOUNT_ENDPOINT is not set");
  const client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  cachedContainer = client.database(DATABASE_NAME).container(RATE_LIMITS_CONTAINER_NAME);
  return cachedContainer;
}

type RateLimitDocument = {
  id: string;
  key: string;
  count: number;
  ttl: number;
  schemaVersion: number;
};

export type RateLimitDeps = {
  container: Pick<Container, "item" | "items">;
  now: () => Date;
};

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

// Framework-agnostic and dependency-injected, same pattern as the handlers —
// so the window logic is testable without a Cosmos account.
export async function checkRateLimit(key: string, deps: RateLimitDeps): Promise<RateLimitResult> {
  const nowSeconds = Math.floor(deps.now().getTime() / 1000);
  const windowStart = nowSeconds - (nowSeconds % RATE_LIMIT_WINDOW_SECONDS);
  const documentId = `${key}:${windowStart}`;
  const retryAfterSeconds = windowStart + RATE_LIMIT_WINDOW_SECONDS - nowSeconds;

  // ttl is set to twice the window so the document outlives its own window by a
  // margin (clock skew, a long-running request) and then deletes itself. Same
  // self-expiring pattern as loginTokens in the data model doc — no cleanup job.
  const document: RateLimitDocument = {
    id: documentId,
    key,
    count: 1,
    ttl: RATE_LIMIT_WINDOW_SECONDS * 2,
    schemaVersion: 1,
  };

  // Read-then-write, not a transaction. Two requests arriving in the same
  // millisecond can both read the same count and each write count+1, letting
  // one extra request through. Accepted deliberately: the alternative (a stored
  // procedure or optimistic-concurrency retry loop) is materially more code for
  // a cost control that only needs to stop sustained volume, and the fixed
  // window already tolerates more than that at its boundaries.
  const { resource: existing } = await deps.container
    .item(documentId, key)
    .read<RateLimitDocument>()
    .catch(() => ({ resource: undefined }));

  if (!existing) {
    await deps.container.items.upsert(document);
    return { allowed: true, retryAfterSeconds };
  }

  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfterSeconds };
  }

  await deps.container.items.upsert({ ...document, count: existing.count + 1 });
  return { allowed: true, retryAfterSeconds };
}

// Production wiring. Fails OPEN: if Cosmos is unreachable, the request is
// allowed and the failure logged. A rate limiter that takes the app down when
// its own storage breaks has turned a cost control into an outage — the app's
// availability matters more than the precision of a spend guard, and the
// scale limit plus the OpenAI TPM cap still bound the blast radius underneath.
export async function checkRateLimitOrAllow(key: string): Promise<RateLimitResult> {
  try {
    return await checkRateLimit(key, { container: getRateLimitsContainer(), now: () => new Date() });
  } catch (err) {
    console.error("rateLimiter unavailable, failing open", err);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
