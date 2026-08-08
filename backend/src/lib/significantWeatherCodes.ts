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

export function describeSignificantWeatherCode(code: number | undefined): string {
  if (code === undefined) return "Weather summary unavailable";
  return SIGNIFICANT_WEATHER_SUMMARIES[code] ?? "Weather summary unavailable";
}
