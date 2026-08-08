import { describe, it, expect, vi } from "vitest";
import { handleCosmosSmokeTest } from "./cosmosSmokeTest";
import type { Container } from "@azure/cosmos";

function makeMockContainer(overrides: Partial<{ upsert: any; read: any; delete: any }> = {}) {
  const upsert = overrides.upsert ?? vi.fn().mockResolvedValue({});
  const read = overrides.read ?? vi.fn().mockResolvedValue({ resource: { id: "smoke-test@internal.invalid" } });
  const del = overrides.delete ?? vi.fn().mockResolvedValue({});

  return {
    items: { upsert },
    item: vi.fn().mockReturnValue({ read, delete: del }),
  } as unknown as Container;
}

describe("handleCosmosSmokeTest", () => {
  it("passes when create/read-back/delete all succeed", async () => {
    const container = makeMockContainer();
    const result = await handleCosmosSmokeTest(container);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ pass: true });
  });

  it("fails when the read-back returns no document", async () => {
    const container = makeMockContainer({ read: vi.fn().mockResolvedValue({ resource: undefined }) });
    const result = await handleCosmosSmokeTest(container);
    expect(result.status).toBe(500);
    expect(result.body.pass).toBe(false);
  });

  it("fails and still attempts cleanup when the write throws", async () => {
    const del = vi.fn().mockResolvedValue({});
    const container = makeMockContainer({ upsert: vi.fn().mockRejectedValue(new Error("RBAC denied")), delete: del });
    const result = await handleCosmosSmokeTest(container);
    expect(result.status).toBe(500);
    expect(result.body.pass).toBe(false);
    expect(del).toHaveBeenCalled();
  });
});
