import { app, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { handleCosmosSmokeTest } from "../handlers/cosmosSmokeTest";
import { getUsersContainer } from "../lib/cosmos";

app.http("cosmosSmokeTest", {
  methods: ["POST"],
  // Never anonymous — this performs a real write/delete against the users
  // container. Invoked manually and by the post-deploy CI step, both of
  // which authenticate with the Function key.
  authLevel: "function",
  route: "internal/cosmos-smoke-test",
  handler: async (_request, context: InvocationContext): Promise<HttpResponseInit> => {
    const result = await handleCosmosSmokeTest(getUsersContainer());
    if (!result.body.pass) {
      context.error("Cosmos smoke-test failed", result.body);
    }
    return { status: result.status, jsonBody: result.body };
  },
});
