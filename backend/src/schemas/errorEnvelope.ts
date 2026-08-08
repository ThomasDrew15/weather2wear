import { z } from "zod";

// Matches docs/weather-outfit-advisor-api-contracts.md's shared error envelope exactly.
export const errorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "LOCATION_NOT_FOUND",
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

const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set([
  "UPSTREAM_UNAVAILABLE",
  "UPSTREAM_UNEXPECTED_RESPONSE",
]);

const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  LOCATION_NOT_FOUND: 404,
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
