import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { handleWeatherFetch } from "../handlers/weatherFetch";
import { resolvePostcode } from "../lib/postcodeResolver";
import { fetchMetOfficeDailyForecast } from "../lib/metOfficeClient";

app.http("weatherFetch", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "weather-fetch",
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }

    const result = await handleWeatherFetch(body, {
      resolvePostcode,
      fetchDailyForecast: fetchMetOfficeDailyForecast,
      now: () => new Date(),
    });

    if (result.status >= 500) {
      context.error("weatherFetch handler returned an error", result.body);
    }

    return { status: result.status, jsonBody: result.body };
  },
});
