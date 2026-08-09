import { z } from "zod";

// Matches docs/weather-outfit-advisor-api-contracts.md's shared error envelope exactly.
export const errorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "LOCATION_NOT_FOUND",
  "RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "UPSTREAM_UNEXPECTED_RESPONSE",
  "INTERNAL_ERROR",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

// RATE_LIMITED is retryable in the contract's sense — "lets the frontend
// decide whether to offer a try again action". Waiting out the window is
// exactly the case that flag exists for.
const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set([
  "RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "UPSTREAM_UNEXPECTED_RESPONSE",
]);

const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  LOCATION_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 502,
  UPSTREAM_UNEXPECTED_RESPONSE: 502,
  INTERNAL_ERROR: 500,
};

export function makeError(code: ErrorCode, message: string): { status: number; body: ErrorEnvelope } {
  return {
    status: HTTP_STATUS_BY_CODE[code],
    body: { error: { code, message, retryable: RETRYABLE_CODES.has(code) } },
  };
}
