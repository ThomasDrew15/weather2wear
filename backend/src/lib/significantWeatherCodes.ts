// Met Office's published significant weather code table — stable across
// DataHub and the older DataPoint API, so lower drift risk than the response
// field names themselves. Codes outside this table fail safe to a generic
// summary rather than throwing, since a display string being generic is far
// less harmful than a whole request failing over one unmapped code.
const SIGNIFICANT_WEATHER_SUMMARIES: Record<number, string> = {
  0: "Clear",
  1: "Sunny",
  2: "Partly cloudy",
  3: "Partly cloudy",
  5: "Mist",
  6: "Fog",
  7: "Cloudy",
  8: "Overcast",
  9: "Light rain showers",
  10: "Light rain showers",
  11: "Drizzle",
  12: "Light rain",
  13: "Heavy rain showers",
  14: "Heavy rain showers",
  15: "Heavy rain",
  16: "Sleet showers",
  17: "Sleet showers",
  18: "Sleet",
  19: "Hail showers",
  20: "Hail showers",
  21: "Hail",
  22: "Light snow showers",
  23: "Light snow showers",
  24: "Light snow",
  25: "Heavy snow showers",
  26: "Heavy snow showers",
  27: "Heavy snow",
  28: "Thundery showers",
  29: "Thundery showers",
  30: "Thunder",
};

const UNKNOWN_SUMMARY = "Weather summary unavailable";

export function describeSignificantWeatherCode(code: number | undefined): string {
  if (code === undefined) return UNKNOWN_SUMMARY;
  return SIGNIFICANT_WEATHER_SUMMARIES[code] ?? UNKNOWN_SUMMARY;
}

// Every summary string this system can produce, derived from the table above
// rather than written out again — the AI-advisor validates its `forecast.summary`
// input against this set (see schemas/aiAdvisor.ts).
//
// Why an allowlist and not just a string: summary is the one advisor input that
// isn't dropdown-selected, and it is interpolated directly into the model
// prompt. It reaches us via the client rather than from Met Office directly, so
// "it came from weather-fetch" is a claim the caller makes, not a fact — which
// makes it a free-text prompt-injection path in a v1 the scope doc says has no
// free-text inputs. Constraining it to the vocabulary weather-fetch can
// actually emit closes that path, and is the "validate/allowlist the exact set
// of accepted values server-side" mitigation the threat model already asks for.
export const WEATHER_SUMMARY_VOCABULARY: readonly string[] = [
  ...new Set(Object.values(SIGNIFICANT_WEATHER_SUMMARIES)),
  UNKNOWN_SUMMARY,
];
