import { getMetOfficeApiKey } from "./secrets";

const DEFAULT_BASE_URL = "https://data.hub.api.metoffice.gov.uk/sitespecific/v0";

// Without a timeout, a stalled upstream connection ties up the invocation
// until the Functions host's own timeout — costly on Consumption.
const REQUEST_TIMEOUT_MS = 15_000;

// Only the daily forecast endpoint is used for v1 (see the v1 scope doc:
// today/tomorrow baseline, multi-day only if straightforward — the daily
// endpoint alone covers "today" through "multiDay" via periods[] slicing).
export async function fetchMetOfficeDailyForecast(lat: number, lon: number): Promise<unknown> {
  const baseUrl = process.env.MET_OFFICE_DATAHUB_BASE_URL ?? DEFAULT_BASE_URL;
  const apiKey = await getMetOfficeApiKey();

  const url = new URL(`${baseUrl}/point/daily`);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("includeLocationName", "true");

  const response = await fetch(url, {
    headers: {
      apikey: apiKey,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Met Office DataHub request failed with status ${response.status}`);
  }

  return response.json();
}
