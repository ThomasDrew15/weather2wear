import type { Container } from "@azure/cosmos";

// Internal-only, disposable verification — NOT part of the public API
// contract (see docs/weather-outfit-advisor-api-contracts.md's Open items).
// Proves the Managed Identity's Cosmos RBAC path (create/read/delete) end to
// end, closing the verification Milestone 2 deferred until backend-compute
// existed. The Function wrapper (src/functions/cosmosSmokeTest.ts) must
// never register this with authLevel "anonymous" — it performs a write.

const SMOKE_TEST_ID = "smoke-test@internal.invalid";

export type CosmosSmokeTestResult = { pass: true } | { pass: false; reason: string };

export async function handleCosmosSmokeTest(container: Container): Promise<{ status: number; body: CosmosSmokeTestResult }> {
  const doc = {
    id: SMOKE_TEST_ID,
    email: SMOKE_TEST_ID,
    schemaVersion: 1,
    smokeTest: true,
    createdAt: new Date().toISOString(),
  };

  try {
    await container.items.upsert(doc);
    const { resource: readBack } = await container.item(SMOKE_TEST_ID, SMOKE_TEST_ID).read();
    await container.item(SMOKE_TEST_ID, SMOKE_TEST_ID).delete();

    if (!readBack) {
      return { status: 500, body: { pass: false, reason: "Round-trip read returned no document." } };
    }
    return { status: 200, body: { pass: true } };
  } catch (err) {
    // Best-effort cleanup — if the write succeeded but read/delete failed,
    // don't leave the fake document behind.
    try {
      await container.item(SMOKE_TEST_ID, SMOKE_TEST_ID).delete();
    } catch {
      // Nothing further to do if cleanup itself fails; the fake id is
      // unmistakable and harmless if it lingers.
    }
    return { status: 500, body: { pass: false, reason: err instanceof Error ? err.message : "Unknown error." } };
  }
}
