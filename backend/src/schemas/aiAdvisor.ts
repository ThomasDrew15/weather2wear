import { z } from "zod";
import { WEATHER_SUMMARY_VOCABULARY } from "../lib/significantWeatherCodes";

// Request/response shapes match docs/weather-outfit-advisor-api-contracts.md's
// AI-advisor Function section exactly.
//
// The forecast fields below are declared here rather than imported from
// weatherFetch.ts, even though they currently match that endpoint's output
// field for field. The advisor is a standalone "weather in, outfit out"
// function: it receives JSON from a caller, not a TypeScript value from
// weather-fetch, so there is no shared type to preserve. The contract that must
// not drift is the API contracts doc, which both endpoints are written against.

// Dropdown-constrained, per the v1 scope doc — no free text in v1. These enums
// are the server-side allowlist the threat model calls for under "Prompt
// injection via structured fields": the frontend is not trusted to only ever
// send valid options, because anyone can post to this endpoint directly.
// Because every value that reaches the prompt comes from one of these closed
// sets, no caller-controlled text can reach the model at all.
export const activityTypeSchema = z.enum(["formal", "informal", "sport"]);
export type ActivityType = z.infer<typeof activityTypeSchema>;

// The contracts doc named coldTolerance as v1's only preference field and gave
// "medium" as its example, but never wrote down the permitted set — a gap found
// while verifying this milestone's assumptions against the docs. Resolved as
// low/medium/high (contains the documented example, mirrors activityType's
// three-value shape) and written into the contracts doc in the same change,
// rather than left implicit in code.
export const coldToleranceSchema = z.enum(["low", "medium", "high"]);
export type ColdTolerance = z.infer<typeof coldToleranceSchema>;

// The contract calls preferences "an open object ... more preference fields can
// be added here without a contract version bump". That means open to future
// named fields we add, not to arbitrary caller input — hence a plain object,
// not .passthrough(): zod strips unknown keys rather than forwarding them.
// Convention for later additions: new preference fields land OPTIONAL, with the
// handler supplying the default, so old clients keep working without the object
// ever having to accept unknown keys.
export const preferencesSchema = z.object({
  coldTolerance: coldToleranceSchema,
});
export type Preferences = z.infer<typeof preferencesSchema>;

// A single forecast period. `date` is accepted but optional and unused: the
// contract's example omits it, while a frontend forwarding a whole selected
// period from weather-fetch would include it. Tolerating both costs nothing.
//
// `summary` is allowlisted rather than accepted as a free string. It is the one
// advisor input that isn't dropdown-selected and it goes straight into the
// model prompt, so left unconstrained it would be a free-text injection path in
// a v1 that is supposed to have none. The permitted set is derived from the Met
// Office significant-weather table weather-fetch itself maps against, so the
// allowlist cannot drift from what this system can actually produce.
export const aiAdvisorRequestBodySchema = z.object({
  forecast: z.object({
    date: z.string().optional(),
    summary: z.string().refine((value) => WEATHER_SUMMARY_VOCABULARY.includes(value), {
      message: "summary must be one of the recognised weather summaries",
    }),
    tempMinC: z.number(),
    tempMaxC: z.number(),
    precipitationChancePercent: z.number().min(0).max(100),
    windSpeedMph: z.number().min(0),
  }),
  activityType: activityTypeSchema,
  preferences: preferencesSchema,
});
export type AiAdvisorRequestBody = z.infer<typeof aiAdvisorRequestBodySchema>;

// Fixed five-field structure, deliberately mirroring the format from the
// original dissertation project. Resolved pregaming Milestone 4: every field
// stays populated rather than nullable — the prompt instructs the model to say
// something like "Not needed" rather than omit a field.
export const recommendationSchema = z.object({
  top: z.string().min(1),
  bottom: z.string().min(1),
  footwear: z.string().min(1),
  outerwear: z.string().min(1),
  accessories: z.string().min(1),
});
export type Recommendation = z.infer<typeof recommendationSchema>;

export const aiAdvisorResponseSchema = z.object({
  recommendation: recommendationSchema,
  modelUsed: z.string(),
  generatedAt: z.string(),
});
export type AiAdvisorResponse = z.infer<typeof aiAdvisorResponseSchema>;

// What we require back from the model, before it becomes a response.
// Deliberately the recommendation alone: modelUsed and generatedAt are facts we
// already hold, and letting the model supply them would mean trusting it to
// self-report which model it is.
//
// .strict() rejects extra keys, but note where the real enforcement lives: the
// request sends this same shape as an Azure OpenAI Structured Output
// (response_format json_schema, strict — see openAiClient.ts), so the service
// constrains the model and a wrong shape cannot come back in the first place.
// This is defense in depth that should never fire. The threat model is
// explicit: "never pass a malformed AI response straight through to the
// frontend".
export const modelOutputSchema = recommendationSchema.strict();

// The same shape as the JSON Schema the Structured Outputs API needs.
// additionalProperties: false and a required[] naming every field are both
// mandatory under strict mode — the API rejects the schema without them, which
// is what makes the guarantee a guarantee.
export const RECOMMENDATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    top: { type: "string" },
    bottom: { type: "string" },
    footwear: { type: "string" },
    outerwear: { type: "string" },
    accessories: { type: "string" },
  },
  required: ["top", "bottom", "footwear", "outerwear", "accessories"],
  additionalProperties: false,
} as const;
