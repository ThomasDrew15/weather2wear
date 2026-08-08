import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  metOfficeDailyResponseSchema,
  mapToForecastPeriods,
  InsufficientForecastDataError,
} from "./metOffice";

// Real Met Office DataHub response, fetched 2026-08-08 against the dev API
// key — see docs/weather-outfit-advisor-api-contracts.md's Open items.
const fixture = JSON.parse(
  readFileSync(join(__dirname, "../../test-fixtures/metoffice-daily-sample.json"), "utf-8")
);

describe("metOfficeDailyResponseSchema", () => {
  it("parses a real DataHub daily response", () => {
    const result = metOfficeDailyResponseSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it("rejects a response missing the FeatureCollection envelope", () => {
    const result = metOfficeDailyResponseSchema.safeParse({ features: [] });
    expect(result.success).toBe(false);
  });
});

describe("mapToForecastPeriods", () => {
  const parsed = metOfficeDailyResponseSchema.parse(fixture);
  const TODAY = "2026-08-08"; // matches the fixture's first usable entry

  it("skips the leading partial (night-only) entry and starts from today", () => {
    const periods = mapToForecastPeriods(parsed, "today", TODAY);
    expect(periods).toHaveLength(1);
    expect(periods[0].date).toBe("2026-08-08");
  });

  it("returns two periods for todayTomorrow", () => {
    const periods = mapToForecastPeriods(parsed, "todayTomorrow", TODAY);
    expect(periods.map((p) => p.date)).toEqual(["2026-08-08", "2026-08-09"]);
  });

  it("returns five periods for multiDay", () => {
    const periods = mapToForecastPeriods(parsed, "multiDay", TODAY);
    expect(periods).toHaveLength(5);
  });

  it("converts wind speed from m/s to mph and rounds temperatures", () => {
    const [today] = mapToForecastPeriods(parsed, "today", TODAY);
    // Fixture: midday10MWindSpeed 2.47 m/s -> ~5.5 mph -> rounds to 6.
    expect(today.windSpeedMph).toBe(6);
    // Fixture: dayMaxScreenTemperature 27.77 -> rounds to 28.
    expect(today.tempMaxC).toBe(28);
    // Fixture: nightMinScreenTemperature 20.0 -> 20.
    expect(today.tempMinC).toBe(20);
  });

  it("maps a known significant weather code to a readable summary", () => {
    const [today] = mapToForecastPeriods(parsed, "today", TODAY);
    // Fixture: daySignificantWeatherCode 3 -> "Partly cloudy".
    expect(today.summary).toBe("Partly cloudy");
  });

  it("throws InsufficientForecastDataError when asking further ahead than the data allows", () => {
    // Requesting from a date past the fixture's last usable entry leaves
    // zero usable entries for a "today" request.
    expect(() => mapToForecastPeriods(parsed, "today", "2026-09-01")).toThrow(
      InsufficientForecastDataError
    );
  });
});
