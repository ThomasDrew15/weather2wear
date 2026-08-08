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

- `forecast` — a single period from the weather-fetch response (frontend selects which day)
- `activityType`: `"formal"` | `"informal"` | `"sport"` — dropdown-selected, per v1 scope
- `preferences` — an open object for dropdown-selected preferences. `coldTolerance` is the only field defined for v1; more preference fields can be added here without a contract version bump, since it's additive.

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

Fixed five-field structure (Top/Bottom/Footwear/Outerwear/Accessories) — deliberately mirrors the format from the original dissertation project, which tested well with stakeholders. `modelUsed` is included for observability/debugging (ties into the OTel instrumentation), not shown to the end user.

### Errors
`INVALID_REQUEST`, `UPSTREAM_UNAVAILABLE`, `UPSTREAM_UNEXPECTED_RESPONSE`, `INTERNAL_ERROR`

---

## Open items
- Exact Met Office DataHub response shape needs mapping to `periods[]` once the API is integrated — field names above are illustrative pending that mapping
- Whether `accessories`/`outerwear` should be nullable (e.g. no outerwear needed in warm weather) rather than always populated — to confirm once prompt design starts in Milestone 4
- This doc doesn't yet cover Milestone 5 (Accounts Backend) — magic-link request/verify and profile CRUD (preferences + locations) need their own request/response contracts, designed when that milestone starts rather than assumed now. The Milestone 3 Cosmos smoke-test is deliberately excluded from this doc entirely — it's internal infra verification, not a public contract.