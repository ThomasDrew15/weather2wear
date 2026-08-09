import type { AiAdvisorRequestBody } from "../schemas/aiAdvisor";

export type ChatMessage = { role: "system" | "user"; content: string };

// Prompt construction lives in its own module, as a pure function: it's the
// part of this feature most likely to be iterated on (wording changes, tone,
// added guidance), and keeping it free of any Azure or network dependency means
// those changes are unit-testable without touching the model.

const SYSTEM_PROMPT = [
  "You are a clothing advisor for a UK weather app.",
  "Given a weather forecast and what the user is doing, recommend what to wear.",
  "",
  "Rules:",
  "- Recommend for the whole day, accounting for the range between the minimum and maximum temperature.",
  "- Temperatures are Celsius, wind speed is mph, precipitation chance is a percentage.",
  "- Keep every field to a short phrase, at most about six words. No sentences, no explanations.",
  "- Every field must be filled in. If an item genuinely isn't needed, say \"Not needed\" rather than leaving it empty.",
  "- Be specific and practical (\"Waterproof jacket\", not \"outerwear\").",
  "- coldTolerance describes how well the user copes with cold: \"low\" feels the cold easily and needs more insulation, \"high\" runs warm and needs less.",
].join("\n");

// Every value interpolated below has already been validated against a closed
// set or a numeric range by aiAdvisor.ts — the two enums, the summary
// allowlist, and bounded numbers. That is what makes prompt injection a
// non-issue in v1: not the wording of this prompt, but the fact that there is
// no untrusted text to inject.
//
// That property is load-bearing and easy to lose. It nearly was: `summary`
// started as a plain z.string(), which would have been a free-text path into
// this prompt in a v1 the scope doc says has no free-text inputs. Anything
// added to this function must come from a validated closed set, or the
// reasoning above stops holding. When v2 adds the deferred free-text context
// field it goes away deliberately, and this is the file that needs hardening.
export function buildMessages(input: AiAdvisorRequestBody): ChatMessage[] {
  const { forecast, activityType, preferences } = input;

  const userContent = [
    `Activity: ${activityType}`,
    `Cold tolerance: ${preferences.coldTolerance}`,
    "Forecast:",
    `- Summary: ${forecast.summary}`,
    `- Temperature: ${forecast.tempMinC}C to ${forecast.tempMaxC}C`,
    `- Chance of precipitation: ${forecast.precipitationChancePercent}%`,
    `- Wind speed: ${forecast.windSpeedMph} mph`,
  ].join("\n");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}
