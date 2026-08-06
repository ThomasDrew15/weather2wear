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

## Open items
- Whether `locations` needs a max-count guard (unlikely to matter at "a few favourites" scale, but worth a sanity limit in validation)

## Resolved Decisions Log
- **Magic-link email delivery:** Azure Communication Services (Email) — see architecture doc's "Notifications" section for reasoning
- **Local development against this data layer:** Cosmos DB emulator locally, rather than real dev-environment Cosmos DB — see architecture doc's "Local Development Workflow" section