import { makeError } from "../schemas/errorEnvelope";
import {
  weatherFetchRequestBodySchema,
  weatherFetchResponseSchema,
  type WeatherFetchResponse,
} from "../schemas/weatherFetch";
import { metOfficeDailyResponseSchema, mapToForecastPeriods, InsufficientForecastDataError } from "../schemas/metOffice";
import { PostcodeNotFoundError, type ResolvedLocation } from "../lib/postcodeResolver";

// Plain TS, no Azure Functions types — this is the code that ports to a
// container almost unchanged in Milestone 8. src/functions/weatherFetch.ts
// is the thin adapter that calls this from an HTTP trigger.

export type WeatherFetchDeps = {
  resolvePostcode: (postcode: string) => Promise<ResolvedLocation>;
  fetchDailyForecast: (lat: number, lon: number) => Promise<unknown>;
  now: () => Date;
};

export type HandlerResult<T> = { status: number; body: T | ReturnType<typeof makeError>["body"] };

export async function handleWeatherFetch(rawBody: unknown, deps: WeatherFetchDeps): Promise<HandlerResult<WeatherFetchResponse>> {
  const parsed = weatherFetchRequestBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return makeError("INVALID_REQUEST", parsed.error.message);
  }
  const { location: locationInput, range } = parsed.data;

  let location: ResolvedLocation;
  try {
    location =
      locationInput.type === "postcode"
        ? await deps.resolvePostcode(locationInput.postcode)
        : { label: `${locationInput.lat}, ${locationInput.lon}`, lat: locationInput.lat, lon: locationInput.lon };
  } catch (err) {
    if (err instanceof PostcodeNotFoundError) {
      return makeError("LOCATION_NOT_FOUND", err.message);
    }
    return makeError("UPSTREAM_UNAVAILABLE", "Could not resolve the requested postcode.");
  }

  let rawForecast: unknown;
  try {
    rawForecast = await deps.fetchDailyForecast(location.lat, location.lon);
  } catch {
    return makeError("UPSTREAM_UNAVAILABLE", "Met Office DataHub was unreachable or returned an error.");
  }

  const parsedForecast = metOfficeDailyResponseSchema.safeParse(rawForecast);
  if (!parsedForecast.success) {
    return makeError("UPSTREAM_UNEXPECTED_RESPONSE", "Met Office DataHub returned an unrecognised response shape.");
  }

  // Captured once — using deps.now() separately for todayIsoDate and
  // generatedAt could disagree across a day boundary.
  const now = deps.now();
  const todayIsoDate = now.toISOString().slice(0, 10);

  let periods;
  try {
    periods = mapToForecastPeriods(parsedForecast.data, range, todayIsoDate);
  } catch (err) {
    if (err instanceof InsufficientForecastDataError) {
      return makeError("UPSTREAM_UNEXPECTED_RESPONSE", err.message);
    }
    throw err;
  }

  const responseBody: WeatherFetchResponse = {
    location,
    generatedAt: now.toISOString(),
    periods,
  };

  // Belt-and-braces: validate our own output against the contract before
  // returning it, same defensive-parsing principle applied to what we hand
  // back, not just what we receive.
  const validated = weatherFetchResponseSchema.safeParse(responseBody);
  if (!validated.success) {
    return makeError("INTERNAL_ERROR", "Failed to construct a valid response.");
  }

  return { status: 200, body: validated.data };
}
