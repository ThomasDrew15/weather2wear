import { makeError } from "../schemas/errorEnvelope";
import { aiAdvisorRequestBodySchema, aiAdvisorResponseSchema, type AiAdvisorResponse } from "../schemas/aiAdvisor";
import { OpenAiUnavailableError, OpenAiUnexpectedResponseError, type GeneratedRecommendation } from "../lib/openAiClient";
import type { RateLimitResult } from "../lib/rateLimiter";
import type { AiAdvisorRequestBody } from "../schemas/aiAdvisor";

// Plain TS, no Azure Functions types — same as weatherFetch.ts, this is the
// code that ports to a container almost unchanged in Milestone 8.

export type AiAdvisorDeps = {
  checkRateLimit: (key: string) => Promise<RateLimitResult>;
  rateLimitKey: string;
  generateRecommendation: (input: AiAdvisorRequestBody) => Promise<GeneratedRecommendation>;
  now: () => Date;
};

export type HandlerResult<T> = { status: number; body: T | ReturnType<typeof makeError>["body"] };

export async function handleAiAdvisor(rawBody: unknown, deps: AiAdvisorDeps): Promise<HandlerResult<AiAdvisorResponse>> {
  // Rate limit before validation, and before any upstream call — the point is
  // to spend as little as possible on a caller who is over the limit, and
  // validation of an untrusted body is itself work worth skipping.
  const rateLimit = await deps.checkRateLimit(deps.rateLimitKey);
  if (!rateLimit.allowed) {
    return makeError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.");
  }

  const parsed = aiAdvisorRequestBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    // Same reasoning as weatherFetch: zod's own .message is verbose and its
    // exact form isn't a stable contract across versions — log the detail
    // server-side, return a fixed message.
    console.error("aiAdvisor request validation failed", parsed.error.issues);
    return makeError("INVALID_REQUEST", "Request body failed validation.");
  }

  let generated: GeneratedRecommendation;
  try {
    generated = await deps.generateRecommendation(parsed.data);
  } catch (err) {
    if (err instanceof OpenAiUnexpectedResponseError) {
      console.error("aiAdvisor upstream returned an unusable response", err);
      return makeError("UPSTREAM_UNEXPECTED_RESPONSE", "The AI service returned a response we couldn't use.");
    }
    if (err instanceof OpenAiUnavailableError) {
      console.error("aiAdvisor upstream unavailable", err);
      return makeError("UPSTREAM_UNAVAILABLE", "The AI service was unreachable or returned an error.");
    }
    // Anything else is a bug in our own code, not an upstream problem —
    // reported honestly as INTERNAL_ERROR rather than blamed on the upstream.
    console.error("aiAdvisor failed unexpectedly", err);
    return makeError("INTERNAL_ERROR", "Failed to generate a recommendation.");
  }

  const responseBody: AiAdvisorResponse = {
    recommendation: generated.recommendation,
    modelUsed: generated.modelUsed,
    generatedAt: deps.now().toISOString(),
  };

  // Belt-and-braces: validate our own output against the contract before
  // returning it, same as weatherFetch.
  const validated = aiAdvisorResponseSchema.safeParse(responseBody);
  if (!validated.success) {
    return makeError("INTERNAL_ERROR", "Failed to construct a valid response.");
  }

  return { status: 200, body: validated.data };
}
