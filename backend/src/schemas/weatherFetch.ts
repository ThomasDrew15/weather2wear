import { z } from "zod";

// Request/response shapes match docs/weather-outfit-advisor-api-contracts.md's
// weather-fetch Function section exactly.

export const weatherFetchRangeSchema = z.enum(["today", "todayTomorrow", "multiDay"]);
export type WeatherFetchRange = z.infer<typeof weatherFetchRangeSchema>;

const locationInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("postcode"), postcode: z.string().min(1) }),
  z.object({ type: z.literal("coordinates"), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
]);
export type LocationInput = z.infer<typeof locationInputSchema>;

export const weatherFetchRequestBodySchema = z.object({
  location: locationInputSchema,
  range: weatherFetchRangeSchema,
});
export type WeatherFetchRequestBody = z.infer<typeof weatherFetchRequestBodySchema>;

export const forecastPeriodSchema = z.object({
  date: z.string(),
  summary: z.string(),
  tempMinC: z.number(),
  tempMaxC: z.number(),
  precipitationChancePercent: z.number().min(0).max(100),
  windSpeedMph: z.number().min(0),
});
export type ForecastPeriod = z.infer<typeof forecastPeriodSchema>;

export const weatherFetchResponseSchema = z.object({
  location: z.object({
    label: z.string(),
    lat: z.number(),
    lon: z.number(),
  }),
  generatedAt: z.string(),
  periods: z.array(forecastPeriodSchema).min(1),
});
export type WeatherFetchResponse = z.infer<typeof weatherFetchResponseSchema>;

// periods[] length by range, per the contract ("one entry for today, two for
// todayTomorrow, up to five for multiDay").
export const PERIOD_COUNT_BY_RANGE: Record<WeatherFetchRange, number> = {
  today: 1,
  todayTomorrow: 2,
  multiDay: 5,
};
