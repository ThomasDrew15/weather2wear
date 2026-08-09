import { z } from "zod";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { modelOutputSchema, RECOMMENDATION_JSON_SCHEMA, type AiAdvisorRequestBody, type Recommendation } from "../schemas/aiAdvisor";
import { buildMessages } from "./outfitPrompt";

// Plain fetch against the REST API rather than an SDK client: the call is a
// single POST, @azure/identity is already a dependency for Key Vault and
// Cosmos, and this keeps the module free of anything Functions- or
// SDK-specific — same reasoning as metOfficeClient.ts.

// Azure AD scope for the Cognitive Services data plane. There is no API key
// here by design: the account is created with local_auth_enabled = false (see
// infra/modules/data), so a key doesn't exist to leak, and access comes from
// the user-assigned Managed Identity's "Cognitive Services OpenAI User" role.
const COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";

// Pinned rather than floating: a GA version that supports Structured Outputs
// (response_format: json_schema), which is what guarantees the five-field shape.
const DEFAULT_API_VERSION = "2024-10-21";

// Same reasoning as metOfficeClient.ts — a stalled upstream shouldn't tie up
// the invocation until the Functions host's own timeout.
const REQUEST_TIMEOUT_MS = 20_000;

// The real response is ~50 tokens; this is headroom, not a target. Bounds the
// cost of any single call and makes a runaway generation impossible. Note the
// interaction with Structured Outputs: truncation produces incomplete JSON, so
// finish_reason is checked below rather than letting a half-object reach the
// parser as a confusing schema error.
const MAX_COMPLETION_TOKENS = 300;

// Low but not zero — clothing suggestions benefit from slight variety, while
// staying consistent for the same weather.
const TEMPERATURE = 0.4;

export class OpenAiUnavailableError extends Error {}
export class OpenAiUnexpectedResponseError extends Error {}

// Only the fields we actually use. Deliberately not a full model of the
// chat-completions response: parsing defensively means asserting what we
// depend on, not mirroring an upstream shape we don't control.
const completionEnvelopeSchema = z.object({
  model: z.string(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string() }),
      }),
    )
    .min(1),
});

let cachedTokenProvider: (() => Promise<string>) | undefined;

function getTokenProvider(): () => Promise<string> {
  if (cachedTokenProvider) return cachedTokenProvider;
  // AZURE_CLIENT_ID (a backend-compute app setting) pins this to the intended
  // user-assigned identity; locally it's unset and DefaultAzureCredential falls
  // back to the az CLI session, which is why the operators group holds the same
  // Cognitive Services OpenAI User role.
  cachedTokenProvider = getBearerTokenProvider(new DefaultAzureCredential(), COGNITIVE_SERVICES_SCOPE);
  return cachedTokenProvider;
}

export type GeneratedRecommendation = {
  recommendation: Recommendation;
  modelUsed: string;
};

export async function generateRecommendation(input: AiAdvisorRequestBody): Promise<GeneratedRecommendation> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  if (!endpoint) throw new Error("AZURE_OPENAI_ENDPOINT is not set");
  if (!deployment) throw new Error("AZURE_OPENAI_DEPLOYMENT is not set");
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? DEFAULT_API_VERSION;

  let token: string;
  try {
    token = await getTokenProvider()();
  } catch (err) {
    // A token failure is an auth/config problem on our side, but from the
    // caller's perspective it's the same shape of outage as the service being
    // down — and it's retryable, since RBAC propagation delays do resolve.
    throw new OpenAiUnavailableError(`Could not acquire an Azure OpenAI token: ${String(err)}`);
  }

  const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messages: buildMessages(input),
        temperature: TEMPERATURE,
        max_tokens: MAX_COMPLETION_TOKENS,
        // The actual guarantee. strict: true means the service constrains the
        // model to this exact schema — no missing fields, no extra keys, no
        // prose or markdown fences around the JSON. Without it, handling
        // malformed model output becomes application code.
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "recommendation",
            strict: true,
            schema: RECOMMENDATION_JSON_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new OpenAiUnavailableError(`Azure OpenAI request failed: ${String(err)}`);
  }

  if (!response.ok) {
    // 429 here is Azure OpenAI's own TPM throttling, not our per-caller rate
    // limit — still an upstream availability problem from the caller's side.
    throw new OpenAiUnavailableError(`Azure OpenAI returned status ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new OpenAiUnexpectedResponseError("Azure OpenAI returned a body that wasn't JSON.");
  }

  return parseCompletion(payload);
}

// Exported for testing: this is the defensive-parsing boundary the threat model
// asks for ("parse upstream responses defensively... rather than trusting the
// shape implicitly"), and it's worth testing without a network call.
export function parseCompletion(payload: unknown): GeneratedRecommendation {
  const envelope = completionEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new OpenAiUnexpectedResponseError("Azure OpenAI response envelope didn't match the expected shape.");
  }

  const choice = envelope.data.choices[0];

  // Truncation check, before parsing. With max_tokens set, a long generation
  // stops mid-JSON and Structured Outputs' shape guarantee no longer holds —
  // the content would fail to parse with a misleading schema error rather than
  // the real cause.
  if (choice.finish_reason === "length") {
    throw new OpenAiUnexpectedResponseError("Azure OpenAI response was truncated before the recommendation was complete.");
  }

  // content_filter is a real, expected outcome rather than a malfunction — the
  // service declining to answer. Reported as an unexpected upstream response so
  // the caller gets the contract's retryable envelope rather than a 500.
  if (choice.finish_reason === "content_filter") {
    throw new OpenAiUnexpectedResponseError("Azure OpenAI declined to produce a recommendation for this input.");
  }

  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(choice.message.content);
  } catch {
    throw new OpenAiUnexpectedResponseError("Azure OpenAI returned content that wasn't valid JSON.");
  }

  // Defense in depth behind Structured Outputs — this should never fire. If it
  // ever does, the service's guarantee has changed and failing loudly is the
  // correct response, not passing a malformed recommendation to the frontend.
  const recommendation = modelOutputSchema.safeParse(parsedContent);
  if (!recommendation.success) {
    throw new OpenAiUnexpectedResponseError("Azure OpenAI returned a recommendation that didn't match the expected five-field shape.");
  }

  return {
    recommendation: recommendation.data,
    // Echoed from the response rather than read from config: modelUsed exists
    // for observability, so it should report what actually served the request,
    // not what we believe is deployed.
    modelUsed: envelope.data.model,
  };
}
