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
    "coldTolerance": "medium",
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

**`preferences` reconciled in Milestone 5 prework** ([issue #47](https://github.com/ThomasDrew15/weather2wear/issues/47)), resolving the disagreement between this document and the API contract that Milestone 4 found:

| Field | Outcome | Why |
|---|---|---|
| `defaultActivityType` | Kept | Maps exactly onto the advisor's `activityType`, same three permitted values |
| `defaultActivityLevel` | **Dropped** | Read by no contract and written by no endpoint. It was never a feature, only a field |
| `coldTolerance` | **Added** | The advisor's only preference input, which previously had nowhere to be saved — the actual bug behind the issue |
| `theme` | Kept | Frontend-only, consumed in Milestone 6 |

**`schemaVersion` deliberately stays at `1`.** No stored document has ever conformed to the old shape — the only documents ever written to `users` are Milestone 3's smoke-test records, which delete themselves within the same request. Bumping the version would advertise a migration that does not exist and would leave a reader hunting for migration code that was never needed. The version exists to make a real future migration targetable, not to record that a design document was edited.

---

### Container: `loginTokens`

**Partition key:** `/email`

**TTL:** enabled at container level — expired magic-link/OTP tokens delete themselves automatically, no cleanup job required.

```json
{
  "id": "<SHA-256 hex of the token>",
  "email": "user@example.com",
  "createdAt": "2026-08-06T12:00:00Z",
  "ttl": 900,
  "schemaVersion": 1
}
```

Kept as a separate container from `users` because tokens have a fundamentally different lifecycle (short-lived, auto-expiring) from the user profile (persistent, long-lived) — mixing them would mean either applying TTL to data that shouldn't expire, or managing token cleanup manually.

**Three changes made during Milestone 5 prework**, before any of this was built:

**1. `id` stores a hash of the token, not the token.** The original shape stored the raw token as the document id, which makes anything that can read this container — a misconfigured role assignment, a support export, a future debugging query — able to mint a login as any user with an outstanding link. Storing `sha256(token)` costs one hash per verify and nothing else: the lookup is still a point read, because the handler hashes the token it was given and reads that id. The raw token exists only in the email and in the request that redeems it. The same applies to `sessions` below.

**2. `schemaVersion` added.** CLAUDE.md requires it on every Cosmos document and the other two containers have it; this shape was written in Milestone 0 before that convention settled and was simply never revisited. Found by re-reading rather than by anything failing.

**3. The partition key only works if verify supplies the email — so the contract now requires it.** This document says the dominant access pattern, "look up this login token", is a single-partition point read. That is only true when the caller has the email in hand, because a point read needs both id and partition key. A magic link carrying only a token would have forced a cross-partition query on the hottest path in the login flow, quietly contradicting the reason the partition key was chosen.

The fix is in the contract, not here: `POST /api/auth/verify` takes `{ email, token }` and the magic link carries both. `/email` is kept rather than repartitioning on the token, because it also makes the second access pattern cheap — deleting a user's other outstanding tokens once one has been redeemed, so a user who requested three links doesn't leave two live credentials sitting in their inbox. Under a token-partitioned container that cleanup would itself be a cross-partition query.

---

### Container: `sessions`

**Partition key:** `/id`

**TTL:** enabled at container level, no blanket default (`-1`) — same self-expiring pattern as `loginTokens` and `rateLimits`. An expired session deletes itself; there is no cleanup job and no unbounded growth.

Added in Milestone 5. Nothing in the Milestone 0 design covered what happens *after* a magic link is verified — `loginTokens` only ever described the link itself — so this container closes a gap in the original data model rather than extending it.

```json
{
  "id": "<SHA-256 hex of the session token>",
  "email": "user@example.com",
  "createdAt": "2026-08-11T12:00:00Z",
  "expiresAt": "2026-09-10T12:00:00Z",
  "ttl": 2592000,
  "schemaVersion": 1
}
```

**Why an opaque token in Cosmos rather than a signed JWT.** A JWT needs no read per request, which is its whole appeal, but it needs a signing key — a long-lived secret to store, rotate and protect, in a project whose consistent position since Milestone 2 has been that the best secret is one that doesn't exist. It is also not revocable before expiry, which would make the logout endpoint a lie. An opaque token trades one point read (the cheapest operation Cosmos offers) for no new secret and real revocation, which is the right way round at this scale.

**Why partitioned by `/id` rather than `/email`, unlike every other container here.** The only lookup is "given this bearer token, whose session is it", and the token is all the caller supplies — there is no email in hand to partition by. Partitioning on the id makes that a point read; partitioning on `/email` would make every authenticated request a cross-partition query, which is the opposite of what the other containers' `/email` choice achieves.

The id is the hashed token itself, with no separate duplicate field (`rateLimits` has both `id` and `key` because its id also encodes the window; here there is nothing extra to encode). `email` is stored as an ordinary property, and it is the *only* place any authenticated endpoint may learn the caller's identity from.

**Consequence, accepted:** "sign out everywhere" would need a cross-partition query over this container and is out of v1 scope. `POST /api/auth/logout` revokes the current session only.

`expiresAt` duplicates what `ttl` already enforces, deliberately: `ttl` is a Cosmos mechanism that deletes the document, while `expiresAt` is an application-readable value the handler checks and the verify response returns to the client. Relying on TTL alone would mean trusting deletion timing as an authorization boundary, and Cosmos makes no promise about when expired documents actually disappear.

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
- ~~**Open item for Milestone 5 — stored preferences don't match the API contract.**~~ **Resolved in Milestone 5 prework (2026-08-11).** Found in Milestone 4 while verifying assumptions against the docs: `coldTolerance` — the advisor's only preference input — had nowhere to be saved, and `defaultActivityLevel` was used by no contract, so a saved preference couldn't populate the advisor, which is the point of lightweight accounts. Resolved by dropping `defaultActivityLevel`, adding `coldTolerance`, and keeping `schemaVersion` at 1 (see the `users` section above for the per-field reasoning). The third part of the question — whether the advisor should read preferences server-side once a session exists — was answered **no**: the AI-advisor contract is unchanged, and preferences pre-populate the form client-side instead, so the advisor keeps working for signed-out users and doesn't acquire an auth dependency on a milestone it predates. Full reasoning in the [API contracts doc](./weather-outfit-advisor-api-contracts.md#what-milestone-5-deliberately-does-not-change).
- **`locations` max-count guard:** capped at 10 per user. Cheap defense-in-depth (the whole `users` document is read on every point-read, so an unbounded array is a way to inflate RU cost on every future read of one's own document), not a UX constraint — the scope doc's "a few favourites" framing means 10 is generous headroom, not a realistic ceiling. Enforced in application-layer validation when the `users` container's write path is built (Milestone 5 — Accounts Backend), same as the threat model's dropdown-allowlisting pattern.