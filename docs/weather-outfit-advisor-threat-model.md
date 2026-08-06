# Weather Outfit Advisor — Threat Model Pass

## Approach

A lightweight, boundary-by-boundary review rather than a full enterprise STRIDE exercise — proportionate to a solo portfolio project, but still a deliberate pass done before infra is built, not an afterthought. Covers the four trust boundaries flagged in Milestone 0.

---

## 1. Key Vault / Managed Identity trust boundary

**Assets:** Met Office API key, Azure OpenAI key, any other service credentials.

| Threat | Mitigation |
|---|---|
| Function's managed identity over-permissioned (broader Key Vault access than it needs) | Scope the RBAC role assignment to specific secrets/the vault only — not subscription-wide. Least privilege from the start, not retrofitted. |
| Accidental deletion of secrets | Enable Key Vault soft-delete and purge protection (on by default in current API versions, but worth confirming in Terraform config explicitly). |
| Local dev secrets leaking into git | Managed Identity doesn't work from a local dev machine, so the temptation is a `.env` file with real keys. Use `az login` + Key Vault CLI/SDK for local dev auth instead, so no real secret ever sits in a file that could be committed. |
| Vault reachable over the public internet | Accepted risk for v1 — no VNET/private endpoint at this scale. Revisit when migrating to AKS, where a private endpoint becomes natural alongside cluster networking. |

---

## 2. OIDC federation trust boundary (GitHub Actions → Azure)

**Assets:** the ability to deploy/modify Azure resources.

| Threat | Mitigation |
|---|---|
| Federated credential trusts too broad a subject (any branch, any repo) | Scope the federated credential's subject claim to a specific repo and branch (e.g. `refs/heads/main`), or a GitHub Environment — not a wildcard. |
| A malicious PR triggers a workflow that gets deploy access | Don't run OIDC-authenticated deploy steps on `pull_request` from forks. Restrict deploy-capable workflows to `push` on `main` (or a protected environment requiring approval). |
| The role granted to the federated identity is too broad (e.g. subscription Owner) | Scope the role assignment to Contributor on the specific resource group(s), not subscription-wide. |

---

## 3. Cosmos DB access patterns

**Assets:** user profile data, login tokens.

| Threat | Mitigation |
|---|---|
| Functions authenticate with a Cosmos master key instead of identity-based access | Prefer Cosmos DB's Azure AD/RBAC data-plane access tied to the Function's Managed Identity over master keys — avoids another long-lived secret entirely. |
| App logic fetches data by an arbitrary email from client input, not tied to the authenticated session | The partition key is `/email`, which makes point reads cheap — but that's an efficiency property, not an authorization boundary. The application layer must always scope queries to the *authenticated* user's own email (validated via the login token), never trust an `email` field passed directly by the client. |
| Cosmos account reachable over the public internet | Accepted for v1, consistent with the Key Vault decision above — firewall rules restricting to known ranges are a reasonable middle step if wanted; private endpoint is a later-phase item alongside AKS networking. |

---

## 4. External dependency failure / edge cases

**Assets:** application availability and correctness when Met Office DataHub or Azure OpenAI misbehave.

| Threat / scenario | Mitigation |
|---|---|
| Met Office DataHub unavailable or rate-limited (360 calls/day free tier) | Already has a dedicated `UPSTREAM_UNAVAILABLE` error code in the API contract. Add OTel-based monitoring of daily call volume so dev/CI traffic doesn't silently eat into the same quota as production. |
| Azure OpenAI unavailable, or returns malformed/unexpected content | Already has `UPSTREAM_UNEXPECTED_RESPONSE` in the contract. The AI-advisor handler should validate the model's output against the expected five-field shape before returning it — never pass a malformed AI response straight through to the frontend. |
| Either upstream changes its response shape over time (schema drift) | Parse upstream responses defensively (schema validation at the boundary, e.g. zod in TypeScript) rather than trusting the shape implicitly — fail with `UPSTREAM_UNEXPECTED_RESPONSE` rather than crashing or passing bad data downstream. |
| Prompt injection via structured fields | Low risk in v1 since inputs are dropdown-constrained, not free text — but dropdown values still get interpolated into the AI prompt. Validate/allowlist the exact set of accepted values server-side (don't trust the frontend to only ever send valid options) as cheap defense in depth. Becomes a much bigger concern in v2 once free text is added — already flagged in scope doc as needing dedicated hardening at that point. |

---

## Summary

Nothing here blocks starting Milestone 1 — these are mitigations to build in from the start (least-privilege IAM, scoped OIDC credentials, RBAC over master keys, defensive parsing at upstream boundaries) rather than gaps that need resolving first. The main deliberate deferral is v2's free-text prompt-injection hardening, already scoped as out-of-scope for v1 in the scope doc.