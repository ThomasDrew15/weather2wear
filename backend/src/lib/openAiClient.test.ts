import { describe, it, expect } from "vitest";
import { parseCompletion, OpenAiUnexpectedResponseError } from "./openAiClient";
import { buildMessages } from "./outfitPrompt";

function completion(content: string, finishReason: string | null = "stop") {
  return {
    model: "gpt-4.1-mini",
    choices: [{ finish_reason: finishReason, message: { content } }],
  };
}

const VALID_RECOMMENDATION = {
  top: "Long-sleeve cotton shirt",
  bottom: "Chinos",
  footwear: "Leather boots",
  outerwear: "Waterproof jacket",
  accessories: "Umbrella",
};

describe("parseCompletion", () => {
  it("returns the recommendation and the model that actually served it", () => {
    const result = parseCompletion(completion(JSON.stringify(VALID_RECOMMENDATION)));
    expect(result.recommendation).toEqual(VALID_RECOMMENDATION);
    expect(result.modelUsed).toBe("gpt-4.1-mini");
  });

  // The specific failure max_tokens introduces: truncation breaks Structured
  // Outputs' shape guarantee, and without this check it would surface as a
  // confusing schema error rather than the real cause.
  it("reports truncation distinctly rather than as a schema failure", () => {
    const truncated = '{"top":"Long-sleeve cotton shirt","bottom":"Chin';
    expect(() => parseCompletion(completion(truncated, "length"))).toThrow(OpenAiUnexpectedResponseError);
    expect(() => parseCompletion(completion(truncated, "length"))).toThrow(/truncated/i);
  });

  it("treats a content filter stop as an unusable response, not a crash", () => {
    expect(() => parseCompletion(completion("{}", "content_filter"))).toThrow(/declined/i);
  });

  it("rejects content that isn't JSON", () => {
    expect(() => parseCompletion(completion("Here's what I'd wear: a coat."))).toThrow(OpenAiUnexpectedResponseError);
  });

  it("rejects a recommendation missing a contract field", () => {
    const { accessories, ...missingField } = VALID_RECOMMENDATION;
    expect(() => parseCompletion(completion(JSON.stringify(missingField)))).toThrow(OpenAiUnexpectedResponseError);
  });

  it("rejects a recommendation with an unexpected extra field", () => {
    const extra = { ...VALID_RECOMMENDATION, hat: "Beanie" };
    expect(() => parseCompletion(completion(JSON.stringify(extra)))).toThrow(OpenAiUnexpectedResponseError);
  });

  it("rejects an envelope with no choices", () => {
    expect(() => parseCompletion({ model: "gpt-4.1-mini", choices: [] })).toThrow(OpenAiUnexpectedResponseError);
  });
});

describe("buildMessages", () => {
  const input = {
    forecast: {
      summary: "Light rain",
      tempMinC: 14,
      tempMaxC: 19,
      precipitationChancePercent: 60,
      windSpeedMph: 12,
    },
    activityType: "formal" as const,
    preferences: { coldTolerance: "low" as const },
  };

  it("includes every forecast value and both dropdown selections", () => {
    const [system, user] = buildMessages(input);
    expect(system.role).toBe("system");
    expect(user.content).toContain("Light rain");
    expect(user.content).toContain("14C to 19C");
    expect(user.content).toContain("60%");
    expect(user.content).toContain("12 mph");
    expect(user.content).toContain("formal");
    expect(user.content).toContain("low");
  });

  it("instructs the model to fill every field rather than omit one", () => {
    const [system] = buildMessages(input);
    expect(system.content).toContain("Not needed");
  });
});
