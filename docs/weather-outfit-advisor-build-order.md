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

## Milestone 4 — AI Advisor
- Azure OpenAI-backed Function
- Dropdowns-only inputs per scope doc
- Structured prompt per the contract defined in Milestone 0

## Milestone 5 — Frontend
- `frontend` module (Static Web App)
- Wired to both Functions
- Lightweight accounts UI

## Milestone 6 — Observability & Polish
- OpenTelemetry instrumentation → Azure Monitor
- Dashboards/alerts
- README and portfolio write-up

## Milestone 7 — AKS + KEDA Migration (later phase, separate effort)
- As scoped in the architecture doc: re-platform `frontend` and `backend-compute`, KEDA HTTP scale-to-zero, Collector export switched to Prometheus/Grafana