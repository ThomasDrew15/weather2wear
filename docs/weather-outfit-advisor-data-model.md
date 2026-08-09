# Weather Outfit Advisor — Data Model

## Cosmos DB Containers

Two containers, both partitioned by `/email` — this makes the dominant access pattern ("load this user's data", "look up this login token") a single-partition point read, the cheapest operation Cosmos offers at the serverless tier.

---

### Container: `users`

**Partition key:** `/email`

Holds everything about a user in one document — preferences, saved locations, and (for v2) wardrobe and history. Cosmos favours embedding over joins for small, bounded, always-together-accessed data like this, so one point read renders the whole app for a user.

```json
{
  "id": "user@example.com",
  "email": "user@example.com",
  "schemaVersion": 1,
  "createdAt": "2026-08-06T12:00:00Z",
  "updatedAt": "2026-08-06T12:00:00Z",
  "auth": {
    "type": "magic-link"
  },
  "preferences": {
    "defaultActivityType": "informal",
    "defaultActivityLevel": "medium",
    "theme": "light"
  },
  "locations": [
    {
      "id": "loc_1",
      "label": "Home",
      "postcode": "SW1A 1AA",
      "lat": 51.5014,
      "lon": -0.1419,
      "isDefault": true
    }
  ],
  "wardrobe": [],
  "history": []
}
```

**v2 extensibility, by field:**
- `auth.type` — v1 ships `"magic-link"` only. v2 can add `"password"` or `"oauth"` as alternative values without touching the container or partition key.
- `wardrobe` — reserved empty for v1. v2 populates with user-added clothing items (the "let users add items from their wardrobe" feature flagged as a target in scope).
- `history` — reserved empty for v1. v2 populates with past recommendations, enabling "what did it suggest last time" type features.
- `schemaVersion` — bump when a structural change is needed; lets migration logic target only documents on an old version rather than assuming a shape.

---

### Container: `loginTokens`

**Partition key:** `/email`

**TTL:** enabled at container level — expired magic-link/OTP tokens delete themselves automatically, no cleanup job required.

```json
{
  "id": "<opaque random token>",
  "email": "user@example.com",
  "createdAt": "2026-08-06T12:00:00Z",
  "ttl": 900
}
```

Kept as a separate container from `users` because tokens have a fundamentally different lifecycle (short-lived, auto-expiring) from the user profile (persistent, long-lived) — mixing them would mean either applying TTL to data that shouldn't expire, or managing token cleanup manually.

---

---

### Container: `rateLimits`

**Partition key:** `/key`

**TTL:** enabled at container level, no blanket default — same pattern as `loginTokens`: each counter carries its own short `ttl` and deletes itself once its window has passed, so there's no cleanup job and no unbounded growth.

Added in Milestone 4 to back the AI-advisor's per-caller rate limit (see the [API contracts doc](./weather-outfit-advisor-api-contracts.md)).

```json
{
  "id": "ip:203.0.113.7:1754774400",
  "key": "ip:203.0.113.7",
  "count": 4,
  "ttl": 120,
  "schemaVersion": 1
}
```

`id` is the caller key plus the window's start timestamp, so each window is a distinct document and a fresh window starts by simply not finding one. Partitioned by `/key` for the same reason the other containers use `/email`: the dominant access pattern is a single-partition point read, the cheapest operation at serverless tier — and here it's on the hot path of every AI-advisor request, so it matters more than elsewhere.

**Deliberately not transactional.** Two requests arriving in the same instant can both read the same count and each write count+1, letting one extra through. Accepted: a stored procedure or optimistic-concurrency retry loop is materially more code for a cost control that only needs to stop sustained volume, and the fixed-window approach already tolerates up to 2x the limit across a window boundary.

---

## Resolved Decisions Log
- **Magic-link email delivery:** Azure Communication Services (Email) — see architecture doc's "Notifications" section for reasoning
- **Local development against this data layer:** Cosmos DB emulator locally, rather than real dev-environment Cosmos DB — see architecture doc's "Local Development Workflow" section
- **Open item for Milestone 5 — stored preferences don't match the API contract.** Found while verifying Milestone 4's assumptions against the docs. The `users` document above stores `preferences.defaultActivityType`, `defaultActivityLevel` and `theme`, while the [API contracts doc](./weather-outfit-advisor-api-contracts.md)'s AI-advisor request takes `activityType` plus `preferences.coldTolerance`. So `coldTolerance` — the advisor's only preference input — has nowhere to be saved, and `defaultActivityLevel` is used by no contract. A saved preference therefore can't populate the advisor, which is the point of lightweight accounts. Not a Milestone 4 blocker (the advisor takes its values from the request either way), and deliberately not patched mid-Milestone-4: Milestone 5's build-order entry already says its contracts need designing rather than writing ad hoc, and this reconciliation belongs there.
- **`locations` max-count guard:** capped at 10 per user. Cheap defense-in-depth (the whole `users` document is read on every point-read, so an unbounded array is a way to inflate RU cost on every future read of one's own document), not a UX constraint — the scope doc's "a few favourites" framing means 10 is generous headroom, not a realistic ceiling. Enforced in application-layer validation when the `users` container's write path is built (Milestone 5 — Accounts Backend), same as the threat model's dropdown-allowlisting pattern.