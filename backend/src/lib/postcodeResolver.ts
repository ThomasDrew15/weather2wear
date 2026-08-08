// UK postcode -> lat/lon resolution. Not previously covered by any design
// doc — the architecture/threat model docs only name Met Office DataHub and
// Azure OpenAI as external dependencies. postcodes.io is free, unauthenticated,
// and the de facto standard for exactly this lookup, consistent with this
// project's pattern of using generous free tiers over paid alternatives.
// Worth a line in the threat model's external-dependency section alongside
// Met Office/Azure OpenAI, since it's now a third upstream this Function
// depends on.

export class PostcodeNotFoundError extends Error {}

export type ResolvedLocation = {
  label: string;
  lat: number;
  lon: number;
};

export async function resolvePostcode(postcode: string): Promise<ResolvedLocation> {
  const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`;
  const response = await fetch(url);

  if (response.status === 404) {
    throw new PostcodeNotFoundError(`No location found for postcode "${postcode}"`);
  }
  if (!response.ok) {
    throw new Error(`postcodes.io request failed with status ${response.status}`);
  }

  const body = (await response.json()) as {
    result: { latitude: number; longitude: number; admin_district: string; parish?: string } | null;
  };
  if (!body.result) {
    throw new PostcodeNotFoundError(`No location found for postcode "${postcode}"`);
  }

  return {
    label: body.result.admin_district,
    lat: body.result.latitude,
    lon: body.result.longitude,
  };
}
