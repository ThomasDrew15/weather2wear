import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { handleAiAdvisor } from "../handlers/aiAdvisor";
import { generateRecommendation } from "../lib/openAiClient";
import { checkRateLimitOrAllow } from "../lib/rateLimiter";
import { resolveRateLimitKey } from "../lib/clientAddress";

// Anonymous, like weather-fetch. Deliberate for v1 and recorded as an accepted
// risk in the threat model with a Milestone 6 revisit trigger: this endpoint
// spends money per call, but it's called from a browser, so no secret shipped
// to that browser could protect it. The controls that do apply are the
// per-caller rate limit below, the Function App's scale limit, and the Azure
// OpenAI deployment's TPM cap.
app.http("aiAdvisor", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "ai-advisor",
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }

    const result = await handleAiAdvisor(body, {
      checkRateLimit: checkRateLimitOrAllow,
      rateLimitKey: resolveRateLimitKey({ forwardedFor: request.headers.get("x-forwarded-for") }),
      generateRecommendation,
      now: () => new Date(),
    });

    if (result.status >= 500) {
      context.error("aiAdvisor handler returned an error", result.body);
    }

    return { status: result.status, jsonBody: result.body };
  },
});
