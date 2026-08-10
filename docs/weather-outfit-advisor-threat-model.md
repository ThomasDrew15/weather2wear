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

**Assets:** application availability and correctness when Met Office DataHub, Azure OpenAI, or postcodes.io misbehave.

| Threat / scenario | Mitigation |
|---|---|
| Met Office DataHub unavailable or rate-limited (360 calls/day free tier) | Already has a dedicated `UPSTREAM_UNAVAILABLE` error code in the API contract. Add OTel-based monitoring of daily call volume so dev/CI traffic doesn't silently eat into the same quota as production. |
| postcodes.io unavailable or a postcode genuinely doesn't resolve (added Milestone 3, not part of the original design pass) | weather-fetch's postcode path depends on this third-party lookup before Met Office DataHub can even be called. A non-match returns `LOCATION_NOT_FOUND`; a request failure returns `UPSTREAM_UNAVAILABLE` — same pattern as the other two upstreams, not a bespoke error path. Unauthenticated, so no credential to leak, but it is a single point of failure for the entire postcode-search feature with no fallback provider. Accepted for v1 given the free/no-setup tradeoff already used elsewhere in this stack; revisit if postcode search availability becomes a real user complaint. |
| Azure OpenAI unavailable, or returns malformed/unexpected content | Already has `UPSTREAM_UNEXPECTED_RESPONSE` in the contract. The AI-advisor handler should validate the model's output against the expected five-field shape before returning it — never pass a malformed AI response straight through to the frontend. |
| Either upstream changes its response shape over time (schema drift) | Parse upstream responses defensively (schema validation at the boundary, e.g. zod in TypeScript) rather than trusting the shape implicitly — fail with `UPSTREAM_UNEXPECTED_RESPONSE` rather than crashing or passing bad data downstream. |
| Prompt injection via structured fields | Low risk in v1 since inputs are dropdown-constrained, not free text — but dropdown values still get interpolated into the AI prompt. Validate/allowlist the exact set of accepted values server-side (don't trust the frontend to only ever send valid options) as cheap defense in depth. Becomes a much bigger concern in v2 once free text is added — already flagged in scope doc as needing dedicated hardening at that point. **Corrected Milestone 4 (2026-08-10):** "inputs are dropdown-constrained" did not actually hold. `forecast.summary` in the AI-advisor request is not dropdown-selected — it originates from Met Office but reaches the advisor *via the client*, so "it came from weather-fetch" is a claim the caller makes, not a fact. Left as a plain string it was a working free-text path straight into the model prompt. Found while writing the prompt builder, not by review. Fixed by allowlisting `summary` against the Met Office significant-weather vocabulary that weather-fetch itself maps against, derived from the same table so the two cannot drift. The general lesson is broader than this one field: **"the input is structured" is a property of the whole path, not of where the data originally came from** — check every field that reaches a prompt, including ones that look like they came from a trusted upstream. |

---

---

## 5. Public, cost-incurring endpoints (added Milestone 4)

**Assets:** Azure OpenAI spend and TPM quota; Met Office DataHub's 360-calls/day free tier.

Not part of the original Milestone 0 pass, which covered upstreams *failing* but never this system's own endpoints being *abused*. The AI-advisor makes it concrete: unlike weather-fetch, every call spends money.

| Threat | Mitigation |
|---|---|
| The endpoint is publicly callable by anyone, not just the app's frontend | **Accepted for v1, deliberately.** The v1 architecture has the browser call the Function directly, so the URL is in browser-delivered JavaScript and visible in any network inspector — "internal to the app" is a UX property, not a network one, and no secret shipped to a browser could protect it. A function key would be security theatre once Milestone 6 ships a public SPA. **Revisit trigger: Milestone 6**, which is what publishes the URL to real users; the mechanism to evaluate then is Static Web Apps' linked-backend pattern (browser talks only to the SWA origin) plus access restrictions on the Function App, and eventually per-user identity from Milestone 5's magic-link accounts. |
| Sustained abuse burns Azure OpenAI quota or spend | Layered caps, each bounding a different thing: a per-caller rate limit (10 requests / 60s, Cosmos-backed, see the API contracts doc); `app_scale_limit` on the Function App, bounding how far compute can scale out at all; `max_tokens` per call, bounding any single generation; and the Azure OpenAI deployment's own capacity (20k TPM of the 200k available), which turns sustained excess into upstream 429s rather than an open tap. |
| Rate-limit keys are forgeable, defeating the limit | **Real, confirmed, and only partly mitigated.** Verified against the live deployment: Azure Functions on Consumption populates `X-Forwarded-For` only when the caller sends none, and passes a caller-supplied one through untouched — neither prepending nor appending the real address. The `X-Azure-SocketIP`/`X-Azure-ClientIP` headers are Front Door headers; with no Front Door in front of this app, nothing sets them and nothing strips them, so they are equally forgeable. **Conclusion: no request header identifies the caller, so per-IP rate limiting is not enforceable here at all.** Mitigated by adding a **global** rate limit (60 requests / 60s across all callers), whose key depends on no caller-supplied value and therefore cannot be forged. The per-caller limit is retained as best-effort fairness between honest callers, explicitly not as a security control. Revisit at Milestone 6: a Static Web Apps linked backend with access restrictions would introduce a trusted hop that overwrites the header, at which point per-caller limiting becomes real. **General lesson: a request header is trustworthy only if a hop you control is known to _overwrite_ it — not "set" it, not "usually add" it.** Two implementations were shipped and defeated before this was established, both of which had merely picked a different attacker-controlled value. |
| A global rate limit becomes a denial-of-service lever | Accepted, deliberately. A global limit converts "unbounded spend" into "an abuser can exhaust the shared budget and degrade service for everyone". For this endpoint that is the right way round — spend is unbounded and irreversible, while availability of a pre-launch demo with no users is cheap. It would be the wrong trade for a product with real users, which is why this is scoped with a Milestone 6 revisit rather than treated as finished. |
| The rate limiter itself becomes a availability risk | Fails **open** — if Cosmos is unreachable the request is allowed and the failure logged. A cost control that causes an outage when its own storage breaks is a worse trade than the spend it prevents; the caps above still apply underneath. |
| Abuse of weather-fetch burns the Met Office free tier | Not yet mitigated per-caller — weather-fetch has no rate limit, only the shared `app_scale_limit`. Lower priority than the AI-advisor (no per-call cost, and the quota is shared dev/live already, an accepted risk recorded in Milestone 2 §6), but the same limiter is now available to apply to it. Carried as an open item rather than done quietly. |

---

## Summary

Nothing here blocks starting Milestone 1 — these are mitigations to build in from the start (least-privilege IAM, scoped OIDC credentials, RBAC over master keys, defensive parsing at upstream boundaries) rather than gaps that need resolving first. The main deliberate deferral is v2's free-text prompt-injection hardening, already scoped as out-of-scope for v1 in the scope doc.