import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleWeatherFetch, type WeatherFetchDeps } from "./weatherFetch";
import { PostcodeNotFoundError } from "../lib/postcodeResolver";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "../../test-fixtures/metoffice-daily-sample.json"), "utf-8")
);
const FIXED_NOW = new Date("2026-08-08T12:00:00Z");

function makeDeps(overrides: Partial<WeatherFetchDeps> = {}): WeatherFetchDeps {
  return {
    resolvePostcode: vi.fn().mockResolvedValue({ label: "Westminster", lat: 51.5014, lon: -0.1419 }),
    fetchDailyForecast: vi.fn().mockResolvedValue(fixture),
    now: () => FIXED_NOW,
    ...overrides,
  };
}

describe("handleWeatherFetch", () => {
  it("returns INVALID_REQUEST for a malformed body", async () => {
    const result = await handleWeatherFetch({ nonsense: true }, makeDeps());
    expect(result.status).toBe(400);
    expect((result.body as any).error.code).toBe("INVALID_REQUEST");
  });

  it("returns LOCATION_NOT_FOUND when the postcode doesn't resolve", async () => {
    const deps = makeDeps({
      resolvePostcode: vi.fn().mockRejectedValue(new PostcodeNotFoundError("not found")),
    });
    const result = await handleWeatherFetch(
      { location: { type: "postcode", postcode: "ZZ99 9ZZ" }, range: "today" },
      deps
    );
    expect(result.status).toBe(404);
    expect((result.body as any).error.code).toBe("LOCATION_NOT_FOUND");
  });

  it("returns UPSTREAM_UNAVAILABLE when the Met Office request fails", async () => {
    const deps = makeDeps({ fetchDailyForecast: vi.fn().mockRejectedValue(new Error("network error")) });
    const result = await handleWeatherFetch(
      { location: { type: "coordinates", lat: 51.5, lon: -0.1 }, range: "today" },
      deps
    );
    expect(result.status).toBe(502);
    expect((result.body as any).error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect((result.body as any).error.retryable).toBe(true);
  });

  it("returns UPSTREAM_UNEXPECTED_RESPONSE for a malformed upstream body", async () => {
    const deps = makeDeps({ fetchDailyForecast: vi.fn().mockResolvedValue({ not: "a valid response" }) });
    const result = await handleWeatherFetch(
      { location: { type: "coordinates", lat: 51.5, lon: -0.1 }, range: "today" },
      deps
    );
    expect(result.status).toBe(502);
    expect((result.body as any).error.code).toBe("UPSTREAM_UNEXPECTED_RESPONSE");
  });

  it("returns a valid 200 response for a coordinates request", async () => {
    const result = await handleWeatherFetch(
      { location: { type: "coordinates", lat: 51.5014, lon: -0.1419 }, range: "todayTomorrow" },
      makeDeps()
    );
    expect(result.status).toBe(200);
    const body = result.body as any;
    expect(body.periods).toHaveLength(2);
    expect(body.location).toEqual({ label: "51.5014, -0.1419", lat: 51.5014, lon: -0.1419 });
  });

  it("returns a valid 200 response for a postcode request", async () => {
    const result = await handleWeatherFetch(
      { location: { type: "postcode", postcode: "SW1A 1AA" }, range: "today" },
      makeDeps()
    );
    expect(result.status).toBe(200);
    expect((result.body as any).location.label).toBe("Westminster");
  });
});
