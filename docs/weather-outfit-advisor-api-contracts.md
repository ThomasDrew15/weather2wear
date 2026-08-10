# Weather Outfit Advisor — API Contracts

Contracts for the two Functions defined in the C4 component diagram. Both share a common error envelope. Shapes are designed to be additive-friendly — new optional fields can be introduced later without breaking existing clients.

---

## Shared Error Envelope

Used by both Functions on any non-2xx response.

```json
{
  "error": {
    "code": "LOCATION_NOT_FOUND",
    "message": "Could not resolve a location for the given postcode.",
    "retryable": false
  }
}
```

**Error codes:**
| Code | Meaning | Retryable |
|---|---|---|
| `INVALID_REQUEST` | Request body failed validation (missing/malformed fields) | No |
| `LOCATION_NOT_FOUND` | Postcode/coordinates didn't resolve to a known location | No |
| `RATE_LIMITED` | Caller exceeded the per-caller request limit (HTTP 429) | Yes |
| `UPSTREAM_UNAVAILABLE` | Met Office DataHub or Azure OpenAI unreachable or erroring | Yes |
| `UPSTREAM_UNEXPECTED_RESPONSE` | Upstream responded but in a shape we couldn't parse | Yes |
| `INTERNAL_ERROR` | Unhandled failure in our own code | No |

`retryable` lets the frontend decide whether to offer a "try again" action without needing to know the specific code.

---

## Weather-fetch Function

**Purpose:** resolve a location and return forecast data, shaped consistently regardless of what Met Office DataHub's raw response looks like.

### Request

```json
{
  "location": {
    "type": "postcode",
    "postcode": "SW1A 1AA"
  },
  "range": "todayTomorrow"
}
```

- `location.type`: `"postcode"` | `"coordinates"` — matches the two entry points from scope (postcode search, device geolocation resolved to lat/lon client-side)
- `location.postcode` — present when `type` is `"postcode"`
- `location.lat` / `location.lon` — present when `type` is `"coordinates"`
- `range`: `"today"` | `"todayTomorrow"` | `"multiDay"` — matches the v1 scope decision (today/tomorrow baseline, multi-day if straightforward)

### Response — 200

```json
{
  "location": {
    "label": "Westminster, London",
    "lat": 51.5014,
    "lon": -0.1419
  },
  "generatedAt": "2026-08-06T12:00:00Z",
  "periods": [
    {
      "date": "2026-08-06",
      "summary": "Cloudy with light rain",
      "tempMinC": 14,
      "tempMaxC": 19,
      "precipitationChancePercent": 60,
      "windSpeedMph": 12
    }
  ]
}
```

`periods` has one entry for `"today"`, two for `"todayTomorrow"`, up to five for `"multiDay"` — same shape regardless of range, so the frontend doesn't need range-specific parsing logic.

### Errors
`INVALID_REQUEST`, `LOCATION_NOT_FOUND`, `UPSTREAM_UNAVAILABLE`, `UPSTREAM_UNEXPECTED_RESPONSE`, `INTERNAL_ERROR`

---

## AI-advisor Function

**Purpose:** take a forecast plus user-supplied context and return a structured clothing recommendation.

### Request

```json
{
  "forecast": {
    "summary": "Cloudy with light rain",
    "tempMinC": 14,
    "tempMaxC": 19,
    "precipitationChancePercent": 60,
    "windSpeedMph": 12
  },
  "activityType": "informal",
  "preferences": {
    "coldTolerance": "medium"
  }
}
```

- `forecast` — a single period from the weather-fetch response (frontend selects which day). A `date` field is accepted and ignored, so a frontend can forward a whole weather-fetch period unchanged.
- `forecast.summary` — **must be one of the summary strings weather-fetch itself produces** (the Met Office significant-weather vocabulary: `"Sunny"`, `"Light rain"`, `"Heavy snow showers"`, and so on, plus `"Weather summary unavailable"`). Not free text. Added in Milestone 4: it's the only advisor input that isn't dropdown-selected and it is interpolated into the model prompt, so accepting arbitrary strings here would be a free-text prompt-injection path in a v1 that is specified to have none. See the threat model's prompt-injection row.
- `activityType`: `"formal"` | `"informal"` | `"sport"` — dropdown-selected, per v1 scope
- `preferences` — an open object for dropdown-selected preferences. `coldTolerance` is the only field defined for v1; more preference fields can be added here without a contract version bump, since it's additive. **Convention for later additions:** new preference fields land *optional*, with the handler supplying the default, so the object never has to accept unknown keys to stay backward-compatible.
- `preferences.coldTolerance`: `"low"` | `"medium"` | `"high"` — how well the user copes with cold (`low` feels the cold easily and needs more insulation). **Added Milestone 4:** this doc previously gave `"medium"` as an example without ever stating the permitted set, which left the threat model's "allowlist the exact set of accepted values server-side" mitigation impossible to implement against a defined list. Found while verifying Milestone 4's assumptions against the docs rather than during implementation.

**v2 forward-compatibility note:** the deferred free-text context box will add an optional `context: string` field to this request. Because it's new and optional, v1-shaped requests keep working unchanged — the prompt-injection/content-safety hardening that field requires can be scoped and built entirely within the AI-advisor handler, without touching this contract's existing fields.

### Response — 200

```json
{
  "recommendation": {
    "top": "Long-sleeve cotton shirt",
    "bottom": "Chinos",
    "footwear": "Leather boots",
    "outerwear": "Waterproof jacket",
    "accessories": "Umbrella"
  },
  "modelUsed": "gpt-4o-mini",
  "generatedAt": "2026-08-06T12:05:00Z"
}
```

Fixed five-field structure (Top/Bottom/Footwear/Outerwear/Accessories) — deliberately mirrors the format from the original dissertation project, which tested well with stakeholders. `modelUsed` is included for observability/debugging (ties into the OTel instrumentation), not shown to the end user. It reports the model that actually served the request (echoed from the upstream response), not the configured deployment name, so it stays honest if a deployment is ever swapped underneath.

### Rate limiting
Added Milestone 4. This endpoint costs money per call, so it is rate-limited in two layers, returning `RATE_LIMITED` (HTTP 429) once either is exceeded:

- **Global: 60 requests per 60-second fixed window, across all callers.** Checked first. This is the layer that actually bounds abuse, because its key depends on nothing the caller supplies and so cannot be forged.
- **Per-caller: 10 requests per 60-second window**, keyed on the address from `X-Forwarded-For`. **Best-effort only.** Verified against the live deployment: Azure Functions on Consumption passes a caller-supplied `X-Forwarded-For` through untouched, so this key is forgeable and provides fairness between honest callers rather than protection against a determined one. Revisit at Milestone 6, when a Static Web Apps linked backend would introduce a trusted hop that can overwrite the header.

Both limits are checked before request validation and before any upstream call, so a caller over the limit costs nothing to reject. Note the consequence: **requests rejected for validation still consume the limit**, since the check happens first. That is deliberate — junk traffic shouldn't be free — but it means a buggy client burns its own allowance.

The global limit's trade-off is bluntness: sustained abuse degrades service for everyone rather than only for the abuser. That is the correct trade here, where spend is unbounded and irreversible while availability of a pre-launch demo is cheap. It would not be for a product with real users.

The limiter fails **open**: if its backing store is unavailable, requests are allowed and the failure is logged. A rate limiter that takes the endpoint down when its own storage breaks converts a cost control into an outage. The Function App's scale limit and the Azure OpenAI deployment's TPM cap still bound the blast radius underneath it.

### Errors
`INVALID_REQUEST`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, `UPSTREAM_UNEXPECTED_RESPONSE`, `INTERNAL_ERROR`

---

## Open items
- Exact Met Office DataHub response shape needs mapping to `periods[]` once the API is integrated — field names above are illustrative pending that mapping
- ~~Whether `accessories`/`outerwear` should be nullable~~ — resolved pregaming Milestone 4: kept always populated (matches the dissertation-tested fixed five-field format), the prompt instructs the model to say something like "Not needed" rather than omit a field
- This doc doesn't yet cover Milestone 5 (Accounts Backend) — magic-link request/verify and profile CRUD (preferences + locations) need their own request/response contracts, designed when that milestone starts rather than assumed now. The Milestone 3 Cosmos smoke-test is deliberately excluded from this doc entirely — it's internal infra verification, not a public contract.