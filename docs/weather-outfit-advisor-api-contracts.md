# Weather Outfit Advisor — API Contracts

Contracts for the Functions defined in the C4 component diagram — weather-fetch and AI-advisor (Milestones 3–4), plus the accounts endpoints added in Milestone 5. All share a common error envelope. Shapes are designed to be additive-friendly — new optional fields can be introduced later without breaking existing clients.

---

## Shared Error Envelope

Used by every Function on any non-2xx response.

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
| `UNAUTHENTICATED` | No session token, or one that is invalid, expired or revoked (HTTP 401) | No |
| `LOCATION_NOT_FOUND` | Postcode/coordinates didn't resolve to a known location | No |
| `RATE_LIMITED` | Caller exceeded the per-caller request limit (HTTP 429) | Yes |
| `UPSTREAM_UNAVAILABLE` | Met Office DataHub, Azure OpenAI or Azure Communication Services unreachable or erroring | Yes |
| `UPSTREAM_UNEXPECTED_RESPONSE` | Upstream responded but in a shape we couldn't parse | Yes |
| `INTERNAL_ERROR` | Unhandled failure in our own code | No |

`retryable` lets the frontend decide whether to offer a "try again" action without needing to know the specific code.

**`UNAUTHENTICATED` added Milestone 5**, the second code added to this envelope after `RATE_LIMITED` (Milestone 4) — and, like that one, added here deliberately rather than improvised in a handler, since CLAUDE.md forbids inventing new error shapes.

Two deliberate non-additions, recorded because the absence is a decision rather than an oversight:

- **No separate code for an invalid or expired magic link.** `UNAUTHENTICATED` covers it, with the message distinguishing the cases for the UI. A magic-link token and a session token are the same kind of thing failing in the same way; splitting them would grow the envelope for no decision the frontend makes differently.
- **No `FORBIDDEN`/403 anywhere.** There is no path in which an authenticated caller may reach another user's data, because the accounts endpoints derive the email from the session and never from the request (see [Accounts endpoints](#accounts-endpoints-milestone-5) below). An error code for "authenticated but not allowed" would describe a state this design cannot enter.

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

## Accounts endpoints (Milestone 5)

Five endpoints: two to establish a session, one to end it, two to read and write the profile. Together they are what makes the v1 scope doc's "lightweight accounts — save preferences and locations across visits" real.

### How a caller authenticates

`Authorization: Bearer <sessionToken>` on the profile and logout endpoints. The two `auth/*` endpoints below are the only unauthenticated ones.

**Why a bearer header rather than a cookie.** A cookie is ambient — the browser attaches it to qualifying requests whether or not the page meant to make them, which is what CSRF is. Avoiding that needs `SameSite` plus, in v1, cross-origin cookie handling, because the frontend (Static Web Apps) and the API (Function App) are different origins until Milestone 6's linked-backend pattern puts them behind one. A bearer token is never sent ambiently, so CSRF does not apply to it at all.

The honest cost: a bearer token has to live somewhere the page's own JavaScript can read, so an XSS bug exposes it, where an `HttpOnly` cookie would not. That is accepted for v1 and carries a **Milestone 6 revisit trigger** — the same milestone that introduces the trusted hop, at which point same-origin `HttpOnly` + `SameSite=Strict` cookies become both viable and better. Recorded in the threat model rather than left as an implicit trade.

---

### `POST /api/auth/request-link`

Sends a magic link to the address given. Unauthenticated.

**Request**
```json
{ "email": "user@example.com" }
```

**Response — 202**
```json
{ "status": "sent" }
```

**This response is returned for any syntactically valid address, whether or not an account exists.** That is what stops the endpoint being a user-enumeration oracle. It costs nothing to guarantee here, because verify creates the account on first success (see below) — so "this address has no account" is not a state the system can be in, and there is no branch that could leak.

The 202 is deliberate over 200: the request has been accepted, and whether the mail is ultimately delivered is not known at response time. Nothing in the response reveals delivery outcome, because doing so would reintroduce the oracle by another route.

**Errors:** `INVALID_REQUEST` (not a syntactically valid address), `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE` (Azure Communication Services unreachable or throttling), `INTERNAL_ERROR`.

#### Rate limiting

Two layers, checked in this order, reusing the Cosmos-backed limiter built in Milestone 4:

- **Global: 5 requests per 60-minute fixed window, across all callers.** Checked first, for the reason established in Milestone 4 — its key depends on nothing the caller supplies, so it cannot be forged, and checking a forgeable limit first would let anyone step past it.
- **Per-email: 3 requests per 60-minute window**, keyed on the normalised address in the request body.

**The per-email key is a genuinely better key than the per-IP one Milestone 4 was forced to abandon**, and for a specific reason worth stating rather than assuming: it is still caller-supplied and still trivially varied, but *varying it does not achieve the harm it exists to prevent*. This limit protects a victim's inbox from being flooded; an attacker who rotates to a different address has stopped attacking that inbox. It is not a general-purpose caller limit and must not be documented as one — abuse of the endpoint in aggregate is bounded by the global limit, exactly as with the AI-advisor.

**Why the global limit is so low.** Azure Communication Services on an Azure Managed Domain is capped at 5 emails per minute and **10 per hour, per subscription, with no increase available** (verified against Microsoft's published service limits during Milestone 5 prework). Our own limit sits below that ceiling so that exceeding it produces a clean `RATE_LIMITED` with `retryable: true`, rather than an opaque upstream 429 surfacing as `UPSTREAM_UNAVAILABLE`. Note the fixed-window limiter tolerates up to 2x across a window boundary, so 5 per window has a worst case of 10 per hour — which is the ACS ceiling exactly, and is why the figure is 5 rather than 8.

That ceiling is a demo-scale constraint, not a product-scale one, and it is the concrete reason the custom-domain migration is carried as a follow-up rather than treated as optional polish.

---

### `POST /api/auth/verify`

Exchanges a magic-link token for a session. Unauthenticated. Creates the account if it doesn't exist.

**Request**
```json
{
  "email": "user@example.com",
  "token": "<opaque token from the magic link>"
}
```

**Both fields are required**, and the email is not merely informational: `loginTokens` is partitioned by `/email`, so the pair is what makes the lookup a single-partition point read. See the data model doc's note on this — it was a real gap found during Milestone 5 prework, not a shape chosen for convenience.

**Response — 200**
```json
{
  "session": {
    "token": "<opaque session token>",
    "expiresAt": "2026-09-10T12:00:00Z"
  },
  "profile": {
    "email": "user@example.com",
    "preferences": {
      "defaultActivityType": "informal",
      "coldTolerance": "medium",
      "theme": "light"
    },
    "locations": []
  }
}
```

The profile is returned inline rather than requiring an immediate follow-up `GET /api/profile`. One round trip instead of two on the single most latency-visible moment in the app, and the handler has the document in hand already.

**Token handling, specified here because it's contract-visible behaviour:**
- The magic-link token is **single-use** — consumed (deleted) on the first successful verify. A replayed link fails.
- It expires after **15 minutes** (the `ttl` already specified for `loginTokens` in the data model doc).
- On success, any *other* outstanding login tokens for the same address are deleted too, so a user who clicked "send me a link" three times doesn't leave two live credentials in their inbox. Cheap because `loginTokens` is partitioned by `/email`.

**Errors:** `INVALID_REQUEST`, `UNAUTHENTICATED` (token unknown, already used, or expired — one message, not three, since telling a caller *which* is a small oracle for no user benefit), `RATE_LIMITED`, `INTERNAL_ERROR`.

---

### `POST /api/auth/logout`

Revokes the current session. Requires `Authorization: Bearer`.

**Request:** no body.

**Response — 204**, no body.

Revocation is a delete of the session document, which is the whole practical advantage of opaque tokens over signed ones and would not be available with a JWT. **Scope is the current session only** — "sign out everywhere" would need a cross-partition query over `sessions` (see the data model doc's partitioning note) and is out of v1 scope.

Calling logout with a token that is already invalid returns 204, not 401. There is no information in the distinction and no action the caller would take differently.

**Errors:** `INTERNAL_ERROR`.

---

### `GET /api/profile`

Returns the authenticated user's profile. Requires `Authorization: Bearer`.

**Response — 200:** the same `profile` object shape returned by verify.

**Errors:** `UNAUTHENTICATED`, `INTERNAL_ERROR`.

---

### `PUT /api/profile`

Replaces the caller's preferences and saved locations. Requires `Authorization: Bearer`.

**Request**
```json
{
  "preferences": {
    "defaultActivityType": "informal",
    "coldTolerance": "medium",
    "theme": "light"
  },
  "locations": [
    {
      "label": "Home",
      "postcode": "SW1A 1AA",
      "lat": 51.5014,
      "lon": -0.1419,
      "isDefault": true
    }
  ]
}
```

**Response — 200:** the resulting `profile` object, i.e. the same shape `GET` returns.

**`PUT` with replace semantics, not `PATCH` with merge semantics.** Merge needs an answer for "what does absent mean" on every field and every array element, and the entire profile is a few hundred bytes that the client already holds — so a full replace is both simpler to specify and impossible to get subtly wrong. It does mean a client must send the whole object; that is the trade, and at this size it is not a real cost.

**Fields the client cannot set.** `email`, `id`, `createdAt`, `updatedAt`, `schemaVersion`, `wardrobe` and `history` are server-owned and rejected as unknown keys rather than silently ignored. In particular:

> **`email` is never read from the request body on any authenticated endpoint — it comes from the session document, always.** This is the threat model's Cosmos mitigation stated as a contract rule: the `/email` partition key makes point reads cheap, which is an efficiency property and not an authorization boundary. Accepting a client-supplied email here would turn a cheap read into an arbitrary-user read.

**Validation rules:**

| Rule | Failure |
|---|---|
| `preferences.defaultActivityType` ∈ `formal` \| `informal` \| `sport` | `INVALID_REQUEST` |
| `preferences.coldTolerance` ∈ `low` \| `medium` \| `high` | `INVALID_REQUEST` |
| `preferences.theme` ∈ `light` \| `dark` | `INVALID_REQUEST` |
| `locations` length ≤ **10** | `INVALID_REQUEST` |
| At most one location with `isDefault: true` | `INVALID_REQUEST` |
| `label` length ≤ 60 | `INVALID_REQUEST` |
| Unknown keys anywhere in the body | `INVALID_REQUEST` |

The `locations` cap is the data model doc's max-count guard, enforced here as that doc said it would be. It is cost defence rather than a UX limit: the whole `users` document is read on every point read, so an unbounded array inflates the RU cost of every subsequent read of one's own profile.

**Location `id`s are assigned by the server**, not accepted from the client — under replace semantics the client has no need to name them, and not accepting them removes uniqueness validation and id-collision handling entirely.

**Errors:** `INVALID_REQUEST`, `UNAUTHENTICATED`, `INTERNAL_ERROR`.

---

### What Milestone 5 deliberately does *not* change

**The AI-advisor contract is untouched.** Issue [#47](https://github.com/ThomasDrew15/weather2wear/issues/47) asked whether the advisor should read stored preferences server-side once a session exists. It should not, for three reasons:

1. The advisor must keep working for signed-out users. That is the v1 UX — accounts are a convenience layered on top, not a gate in front.
2. The advisor is anonymous by deliberate design, recorded as an accepted risk in the threat model with its own Milestone 6 revisit. Making it session-aware would change its auth model mid-v1 and couple two milestones that are currently independent.
3. It would make a working, verified endpoint depend on one that doesn't exist yet, for no behaviour the client can't produce itself.

**Stored preferences pre-populate the advisor form client-side instead** — the frontend reads the profile once and uses `defaultActivityType` and `coldTolerance` as the form's initial values. The user still gets "my saved preference is already filled in", which is the point of lightweight accounts, without the advisor contract acquiring an auth dependency.

---

## Open items
- Exact Met Office DataHub response shape needs mapping to `periods[]` once the API is integrated — field names above are illustrative pending that mapping
- ~~Whether `accessories`/`outerwear` should be nullable~~ — resolved pregaming Milestone 4: kept always populated (matches the dissertation-tested fixed five-field format), the prompt instructs the model to say something like "Not needed" rather than omit a field
- ~~This doc doesn't yet cover Milestone 5 (Accounts Backend)~~ — resolved in Milestone 5 prework: see [Accounts endpoints](#accounts-endpoints-milestone-5) above, designed before any code was written as the build order required. The Milestone 3 Cosmos smoke-test remains deliberately excluded from this doc entirely — it's internal infra verification, not a public contract.
- **The magic link's URL shape is a frontend concern, settled here only where it constrains this contract.** `POST /api/auth/verify` needs both `email` and `token`, so the link must carry both. Recommendation for Milestone 6: put them in the URL **fragment** (`#email=...&token=...`) rather than the query string, so neither is sent to any server, written to server access logs, or leaked via the `Referer` header when the verify page loads third-party resources. The SPA reads the fragment and POSTs the pair. A query string is the acceptable fallback if the fragment complicates the routing, but that is a decision to make knowingly.
- **Session lifetime is 30 days, absolute rather than sliding.** A sliding window would need a Cosmos write on every authenticated request purely to extend it, doubling the per-request data cost of every profile read to buy convenience. Revisit if 30 days proves too short in real use.