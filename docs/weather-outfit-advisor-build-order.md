# Weather Outfit Advisor — Build Order & Milestones

## Approach

Due diligence is front-loaded as its own milestone before any code is written, given the project's explicit goal of demonstrating good engineering practice (not just shipping a working app). Each subsequent milestone builds on artifacts produced in Milestone 0 (contracts, data model, diagrams) rather than letting them emerge ad hoc during implementation.

---

## Milestone 0 — Due Diligence

**Goal:** have a complete, reviewed design before writing any application code.

- **C4 diagrams**
  - Context: system + external actors (user, Met Office DataHub, Azure OpenAI)
  - Container: frontend, backend-compute, data, secrets
  - Component: inside backend-compute — weather-fetch handler, AI-advisor handler, shared types
- **Quick-reference sketches** (informal, for anything C4 doesn't suit well)
  - Sequence diagram: a single "get recommendation" request end to end
  - CI/CD pipeline flow
  - v1 → later-phase (AKS/KEDA) migration diagram
- **Data model**
  - Cosmos DB document shapes for lightweight accounts (preferences, saved locations)
  - Partition key strategy (matters for cost/performance at serverless tier)
- **API contracts**
  - Request/response shapes for the weather-fetch Function
  - Request/response shapes for the AI-advisor Function
  - Error shapes for both
- **Threat model pass**
  - Key Vault / Managed Identity trust boundary
  - OIDC federation trust boundary (GitHub Actions → Azure)
  - Cosmos DB access patterns
  - External dependency failure/edge cases (Met Office or Azure OpenAI unavailable or returning unexpected data)

---

## Milestone 1 — Infra Bootstrap
- `bootstrap` Terraform module (state storage account + container, initial Key Vault)
- `environments/dev` and `environments/live` scaffolding
- GitHub Actions OIDC connection to Azure, proven end-to-end with a trivial `terraform plan` check in CI

## Milestone 2 — Data & Secrets
- `data` module (Cosmos DB, serverless)
- `secrets` module (Key Vault + role assignments)
- Managed Identity wiring, provable in isolation before any app code depends on it

## Milestone 3 — Backend Compute Core
- `backend-compute` module
- Weather-fetch Function against Met Office DataHub, built to the API contract from Milestone 0
- No AI yet — real weather data flowing end-to-end first
- A disposable, internal-only Cosmos smoke-test (create/read/delete against the `users` container, function-key-protected, not part of the public API contract) — proves the Managed Identity's Cosmos RBAC path end-to-end, discharging the verification Milestone 2 deferred until `backend-compute` existed

## Milestone 4 — AI Advisor
- Azure OpenAI-backed Function
- Dropdowns-only inputs per scope doc
- Structured prompt per the contract defined in Milestone 0
- Azure OpenAI account + model deployment added to the `data` module (not `backend-compute` — see architecture doc's Backend Compute section for why), ~~API key seeded into the existing per-environment Key Vault following the Met Office key's pattern exactly~~ — **superseded during Milestone 4 (2026-08-10): no API key at all.** The account is created with `local_auth_enabled = false` and the Function reaches it via the existing user-assigned Managed Identity's `Cognitive Services OpenAI User` role, matching what `data` already does for Cosmos (`local_authentication_enabled = false`) and `backend-compute` for its runtime storage (`shared_access_key_enabled = false`). This line was written in Milestone 0, before both the Milestone 2 state-leak incident and the identity-only convention that followed it; the threat model's "prefer Azure AD/RBAC over master keys — avoids another long-lived secret entirely" already applied. There is no secret to seed for this milestone. Full reasoning, including why the Key Vault approach wouldn't have avoided the state problem anyway, is in the [Milestone 4 log](./milestone-4-ai-advisor.md).

## Milestone 5 — Accounts Backend
- New `notifications` Terraform module — Azure Communication Services account (via `azapi`, with `disableLocalAuth`), Email Communication Service, Azure Managed Domain
- `sessions` Cosmos container added to the `data` module
- Magic-link request/verify Functions (Azure Communication Services email delivery)
- User profile CRUD (preferences + locations, including the `locations` max-count guard from the data model doc)
- ~~Its own request/response contract, designed before it's built~~ — **done in prework (2026-08-11), before any code**: see the [API contracts doc](./weather-outfit-advisor-api-contracts.md#accounts-endpoints-milestone-5) for all five endpoints and the new `UNAUTHENTICATED` error code. The prework also closed [#47](https://github.com/ThomasDrew15/weather2wear/issues/47) (stored preferences vs the advisor contract) and turned up three gaps in the Milestone 0 design that implementation alone would have papered over: `loginTokens`' partition key only supports a point read if verify is given the email, that container was missing the `schemaVersion` field CLAUDE.md requires, and nothing anywhere described what a session actually *is*. Recorded in the data model doc.

## Milestone 6 — Frontend
- `frontend` module (Static Web App)
- Wired to both Functions
- Lightweight accounts UI

## Milestone 7 — Observability & Polish
- OpenTelemetry instrumentation → Azure Monitor
- Dashboards/alerts
- README and portfolio write-up

## Milestone 8 — AKS + KEDA Migration (later phase, separate effort)
- As scoped in the architecture doc: re-platform `frontend` and `backend-compute`, KEDA HTTP scale-to-zero, Collector export switched to Prometheus/Grafana