# Weather Outfit Advisor — Project Context

From-scratch rebuild of a dissertation project: a web app that recommends clothing based on weather. New stack, new infra — not an iteration on old code.

## Current status
Milestones 0–4 (due diligence, Infra Bootstrap, Data & Secrets, Backend Compute Core, AI Advisor) are complete — see the engineering log for what was actually built and what went wrong along the way. Both the weather-fetch and AI-advisor Functions are deployed to `dev`. Starting Milestone 5 (Accounts Backend), which needs its own request/response contracts designed before any code is written.

## Full context (read these for detail — don't ask the user to re-explain)
@docs/weather-outfit-advisor-v1-scope.md
@docs/weather-outfit-advisor-architecture.md
@docs/weather-outfit-advisor-build-order.md
@docs/weather-outfit-advisor-data-model.md
@docs/weather-outfit-advisor-api-contracts.md
@docs/weather-outfit-advisor-threat-model.md
@README.md
@docs/milestone-0-due-diligence.md
@docs/milestone-1-infra-bootstrap.md
@docs/milestone-2-data-secrets.md
@docs/milestone-3-backend-compute-core.md
@docs/milestone-4-ai-advisor.md

## Stack (short version — see architecture doc for full reasoning)
- TypeScript throughout
- v1 runtime: Azure Static Web Apps (frontend) + Azure Functions (backend) + Cosmos DB serverless (data)
- Later phase (not yet): containers on AKS + KEDA — do not build against AKS yet, v1 is Functions-based
- IaC: Terraform, GitHub Actions with OIDC (no stored Azure credentials)
- AI: Azure OpenAI Service direct, GPT-4o-mini or GPT-5-nano

## Conventions to follow
- Keep backend logic framework-agnostic — plain HTTP handlers thinly wrapped for Azure Functions, not Functions-specific code baked into business logic (this is what makes the later AKS migration cheap)
- Terraform: separate modules per layer (`bootstrap`, `frontend`, `backend-compute`, `data`, `secrets`, `observability`), separate `environments/dev` and `environments/live` root modules — not Terraform Workspaces
- Secrets: Azure Key Vault, **user-assigned** Managed Identity (not system-assigned — see architecture doc's Secrets Management section for why)
- **Prefer no secret at all.** For any Azure service supporting AAD data-plane access, disable key auth (`local_auth_enabled` / `local_authentication_enabled` / `shared_access_key_enabled = false`) and grant the user-assigned Managed Identity a scoped role instead. Cosmos, the Function's runtime storage, and Azure OpenAI all work this way. Key Vault is for credentials belonging to services with no identity-based option, such as the Met Office DataHub key. Note that "seed the value out-of-band" does not always keep a key out of Terraform state — some resources (e.g. `azurerm_cognitive_account`) export their keys as attributes, so state captures them just by managing the resource; disabling key auth is what actually closes that path
- Terraform manages the Key Vault and its access — **never** a secret's value. `azurerm_key_vault_secret` resources are not used; values are seeded via `az keyvault secret set` out-of-band, so real credentials never land in Terraform state (see architecture doc's "How secret values get into Key Vault")
- Never put real credentials in `.env` files — local auth goes via `az login`
- All Cosmos DB documents need a `schemaVersion` field
- API responses follow the shared error envelope in the API contracts doc — don't invent new error shapes
- Follow the API contracts doc exactly for request/response shapes on the weather-fetch and AI-advisor Functions

## What NOT to do
- Don't add AKS/Kubernetes resources yet — that's Milestone 8, a separate later effort
- Don't add a free-text input field to the AI advisor — explicitly deferred to v2
- Don't build a full password/OAuth auth system — v1 is magic-link only