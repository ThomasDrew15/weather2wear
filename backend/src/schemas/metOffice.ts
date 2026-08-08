import { z } from "zod";
import { describeSignificantWeatherCode } from "../lib/significantWeatherCodes";
import type { ForecastPeriod, WeatherFetchRange } from "./weatherFetch";
import { PERIOD_COUNT_BY_RANGE } from "./weatherFetch";

// Shape confirmed against a real Site Specific daily-forecast response
// (2026-08-08, dev API key) rather than assumed from documentation alone —
// the API contracts doc flags the exact field names as an open item pending
// real integration. Only `time` is required per entry; every meteorological
// field is optional because a real sample showed a leading entry with
// night-only fields (the remainder of a day already mostly elapsed relative
// to the model run) — schema must tolerate that rather than reject the
// whole response over one partial entry.
const timeSeriesEntrySchema = z
  .object({
    time: z.string(),
    daySignificantWeatherCode: z.number().optional(),
    nightSignificantWeatherCode: z.number().optional(),
    dayMaxScreenTemperature: z.number().optional(),
    nightMinScreenTemperature: z.number().optional(),
    dayProbabilityOfPrecipitation: z.number().optional(),
    nightProbabilityOfPrecipitation: z.number().optional(),
    midday10MWindSpeed: z.number().optional(),
    midnight10MWindSpeed: z.number().optional(),
  })
  .passthrough();

export const metOfficeDailyResponseSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z
    .array(
      z.object({
        properties: z.object({
          location: z.object({ name: z.string() }).optional(),
          timeSeries: z.array(timeSeriesEntrySchema),
        }),
      })
    )
    .min(1),
});
export type MetOfficeDailyResponse = z.infer<typeof metOfficeDailyResponseSchema>;
type TimeSeriesEntry = z.infer<typeof timeSeriesEntrySchema>;

// m/s -> mph, per the DataHub Site Specific API's documented units (wind
// speed/gust in m/s, confirmed via the openHAB Met Office DataHub binding's
// channel unit documentation, since Met Office's own docs don't spell this
// out on the page checked at build time).
const METERS_PER_SECOND_TO_MPH = 2.23694;

function isUsableEntry(entry: TimeSeriesEntry): boolean {
  return (
    entry.daySignificantWeatherCode !== undefined &&
    entry.dayMaxScreenTemperature !== undefined &&
    entry.nightMinScreenTemperature !== undefined &&
    entry.dayProbabilityOfPrecipitation !== undefined &&
    entry.midday10MWindSpeed !== undefined
  );
}

function toForecastPeriod(entry: TimeSeriesEntry): ForecastPeriod {
  return {
    date: entry.time.slice(0, 10),
    summary: describeSignificantWeatherCode(entry.daySignificantWeatherCode),
    tempMinC: Math.round(entry.nightMinScreenTemperature as number),
    tempMaxC: Math.round(entry.dayMaxScreenTemperature as number),
    precipitationChancePercent: Math.round(entry.dayProbabilityOfPrecipitation as number),
    windSpeedMph: Math.round((entry.midday10MWindSpeed as number) * METERS_PER_SECOND_TO_MPH),
  };
}

export class InsufficientForecastDataError extends Error {}

/**
 * Selects the requested number of complete, present-or-future day entries
 * and maps them to the API contract's periods[] shape. Throws
 * InsufficientForecastDataError if the upstream response doesn't have
 * enough usable entries for the requested range — callers should translate
 * that to UPSTREAM_UNEXPECTED_RESPONSE, not crash.
 */
export function mapToForecastPeriods(
  response: MetOfficeDailyResponse,
  range: WeatherFetchRange,
  todayIsoDate: string
): ForecastPeriod[] {
  const entries = response.features[0].properties.timeSeries;
  const usable = entries.filter((e) => e.time.slice(0, 10) >= todayIsoDate && isUsableEntry(e));

  const count = PERIOD_COUNT_BY_RANGE[range];
  if (usable.length < count) {
    throw new InsufficientForecastDataError(
      `Expected at least ${count} usable forecast entries for range "${range}", got ${usable.length}`
    );
  }

  return usable.slice(0, count).map(toForecastPeriod);
}
