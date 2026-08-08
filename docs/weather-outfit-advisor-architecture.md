# Weather Outfit Advisor — Architecture

## Approach: Phased

Rather than building on AKS from day one, the plan is to ship a working v1 on simpler, lower-ops Azure services first, then re-platform to AKS + KEDA once the product itself is validated. This de-risks the build (Met Office integration, AI prompt/output quality, UX) before adding cluster networking and event-driven autoscaling on top, and turns the later migration into its own portfolio story rather than doing everything at once as an exercise.

**Design implication for v1:** keep backend logic framework-agnostic — plain HTTP handlers thinly wrapped for Azure Functions, not Functions-specific code baked into the business logic. This keeps the AI-advisor/weather-fetch code portable to a container almost unchanged when the migration happens; only the hosting wrapper changes.

**Terraform implication:** structure infrastructure as separate modules per layer (frontend hosting, backend compute, data layer) so the compute module can be swapped later without touching the DB, CI/CD, or app code.

---

## Frontend Hosting

| Option | Pros | Cons |
|---|---|---|
| **Azure Static Web Apps** | Built for SPA + linked API pattern; free tier; automatic SSL/CDN/custom domains; near-zero ops | Doesn't build AKS/Terraform skills directly — managed black box |
| **Container on AKS** | Shares ingress/cert-manager setup with backend if also on AKS; consistent "everything as code" story; more portfolio depth | More YAML for something that's just static files; slower deploy loop than SWA's built-in CI/CD |

**Decision: Azure Static Web Apps for v1.** Re-platform to AKS alongside the backend in the later phase.

---

## Backend Compute (AI advisor + weather fetching)

| Option | Pros | Cons |
|---|---|---|
| **Azure Functions** | Scales to zero — near-zero cost when idle, matches actual low/spiky traffic pattern; fast to build; low ops | Doesn't build Kubernetes experience (a stated project goal) |
| **AKS containers** | Direct K8s deployment/scaling/observability experience; consistent with later self-hosted-model goal | Real always-on cost (~£25-50/month even parked) unless paired with KEDA for scale-to-zero |
| **Split (some serverless, some AKS)** | — | Adds two deploy pipelines and two monitoring setups without a strong reason — avoided |

**Decision: Azure Functions for v1.** Migrate to AKS + KEDA in the later phase (see below).

**Milestone 4 addition:** the AI-advisor Function itself lives in `backend-compute` alongside weather-fetch (same Function App, new route), but the Azure OpenAI account/model deployment it calls does not — see the `data` module bullet under Terraform Module Structure for why.

### What is KEDA?

KEDA (Kubernetes Event-Driven Autoscaling) is an open-source component that extends Kubernetes' native autoscaling so pods can scale to **zero**, not just between a minimum of 1 and some maximum (which is the limit of the built-in Horizontal Pod Autoscaler). It watches a trigger source — HTTP traffic, queue length, a cron schedule — and spins pods up only when needed, scaling back to zero after a cooldown.

**Complexity, roughly:**
- Installing it (Helm chart / Terraform provider): trivial, ~20 minutes
- Basic scale-to-zero (queue/cron triggers): moderate, an hour or two once the trigger model is understood
- **HTTP-based scale-to-zero** (what a web API needs): meaningfully harder — requires the separate KEDA HTTP Add-on, which adds an interceptor proxy in front of the service, plus cold-start latency on the first request after scale-to-zero needs handling in the UX
- Debugging scaling issues: the real cost — troubleshooting spans KEDA's metrics adapter, the trigger source, and K8s HPA behaviour all at once; confusing the first time, manageable after

**Why it's still the plan for the later phase:** it directly solves the specific problem AKS otherwise has for this project (always-on cost vs. low, spiky traffic), and is a genuine production pattern rather than a toy exercise — a good portfolio line once implemented properly.

---

## Data Layer (lightweight accounts — preferences + locations)

**Decision: Cosmos DB, serverless capacity mode.**

Serverless mode (pay-per-request rather than provisioned throughput) avoids another always-on cost, which matters at this traffic scale — same reasoning as choosing Functions over AKS for v1 compute.

---

## CI/CD Platform

**Decision: GitHub Actions.**

Considered against Azure DevOps Pipelines. Azure DevOps Pipelines is not being deprecated in any formal sense — the "noise" around this is routine lifecycle churn (hosted agent image deprecations, old task versions, an issuer-URL migration for workload identity federation by 2027). However, Microsoft's own engineering teams are actively migrating repositories from Azure Repos to GitHub at scale (the CAP org: 4,000+ repos, 1,600+ migrated in six months), explicitly to get earlier access to GitHub's agentic/AI tooling (Copilot Coding Agent, Code Review, etc.) — while keeping Azure Boards/Pipelines in a hybrid model for teams that still need them. This signals where Microsoft's own investment and momentum is going, even though Azure DevOps Pipelines remains supported.

For this project: code already sits on GitHub, GitHub Actions is the more commonly expected tool in the job market, and it supports OIDC federated credentials to Azure directly — no separate platform to stand up, no long-lived Azure credential to manage as a GitHub secret.

---

## Secrets Management

Secrets in play: Met Office API key, Azure OpenAI key/endpoint, Cosmos DB connection string, plus whatever's needed for CI/CD to authenticate against Azure to deploy. Two separate questions: where secrets *live*, and how CI/CD *gets access* to deploy without needing a stored secret at all.

### Where secrets live: Azure Key Vault

The Azure-native secret store. Integrates directly with Terraform (`azurerm_key_vault_secret`) and both Azure Functions and AKS can pull from it natively, rather than secrets living in `.env` files or scattered CI variables.

### How the app reads secrets

| Approach | Pros | Cons |
|---|---|---|
| **System-assigned Managed Identity** (identity tied to the Function App's own lifecycle, created/destroyed with it) | Simplest to set up — no separate identity resource | Destroying and recreating the Function App generates a *new* identity each time, which would require re-granting Key Vault/Cosmos DB role assignments on every rebuild — a real problem given the plan to tear down `backend-compute` between demos to save cost (see Cost Management below) |
| **User-assigned Managed Identity** (identity is its own resource, defined in `secrets`, then attached to the Function App) | Identity and its role assignments are created once and never touched — persist independently of whether the Function App exists right now; `backend-compute` just attaches a reference to it | Slightly more setup — one extra resource to define |

**Decision: user-assigned Managed Identity**, defined in the `secrets` module rather than tied to `backend-compute`'s lifecycle. This is what makes the cost-management approach below actually low-admin: destroying and recreating `backend-compute` never touches permissions, because the identity granted access to Key Vault and Cosmos DB isn't the thing being destroyed.

### How secret values get into Key Vault

A separate question from *where* secrets live: how does the actual value (Met Office key, Azure OpenAI key, etc.) get set in the first place?

| Approach | Pros | Cons |
|---|---|---|
| **Terraform manages the value** (`azurerm_key_vault_secret` with `value` sourced from a TF variable) | Fully declarative — the secret's existence and value are both defined in code | Terraform tracks every managed resource's attributes in state to detect drift, so the real value gets written into Terraform state as a side effect — turning the state file itself into sensitive material, whether or not that was the intent |
| **Terraform manages the vault only; value seeded via `az keyvault secret set`** | Terraform never reads or writes the value, so it's never in state — the value exists in exactly one place (Key Vault) | The secret's value isn't tracked as code; seeding is a manual one-time step per environment, documented rather than declared |

**Decision: Terraform manages the vault, role assignments, and access — never the secret value.** Discovered mid-Milestone-2 after Terraform-managing the Met Office key's value put it into `dev`'s remote state; the fix was removing the `azurerm_key_vault_secret` resource entirely and seeding via `az keyvault secret set` instead, then `terraform state rm` to drop the value from state going forward. Applies to every secret from here on, including Milestone 4's Azure OpenAI key.

### The bootstrap problem

Terraform itself needs credentials to create the Key Vault in the first place, and Terraform state needs a remote backend (Azure Storage) with its own access control. This is normally solved with a small "bootstrap" step/module that sits slightly outside the main IaC lifecycle (creates the state storage account and initial Key Vault) — to be designed deliberately as part of the Terraform module structure work, not discovered by accident mid-build.

### CI/CD → Azure authentication: OIDC

GitHub Actions supports OIDC federated credentials to Azure — the workflow authenticates via short-lived tokens issued at run time, rather than a long-lived Azure service principal secret sitting in GitHub. This means "how does CI/CD authenticate to deploy" isn't itself a secret-storage problem if set up this way from the start.

---

## Monitoring & Observability

| Option | Pros | Cons |
|---|---|---|
| **Azure Monitor + Application Insights** | Native integration — auto-instruments Functions/Static Web Apps with almost no setup; generous free tier at this scale; one pane of glass, minimal ops | Tightly coupled to Azure; instrumentation doesn't transfer if workloads move elsewhere; not the natural choice once on AKS |
| **Prometheus + Grafana** | De facto standard for Kubernetes observability; fully portable; pairs naturally with KEDA's own metrics in the later phase | Overkill for a couple of Functions in v1 — another thing to self-host for little payoff yet |

**Decision: OpenTelemetry (OTel) for instrumentation, Azure Monitor as the v1 backend.**

OTel decouples *instrumenting the app* (traces, metrics, logs) from *where the data goes*. The app emits telemetry to an OTel Collector; the Collector's export config decides the destination. For v1, the Collector points at Azure Monitor's OTel-compatible ingestion endpoint — cheap, managed, minimal setup. When migrating to AKS, only the Collector's export config changes (Prometheus/Grafana instead), not the instrumentation in the app code itself.

This mirrors the same pattern as keeping backend logic framework-agnostic: decouple the expensive-to-redo part (instrumentation scattered through app code) from the cheap-to-swap part (where the data is sent).

---

## Terraform Module Structure

Module boundaries follow directly from the decisions above — each one wraps a layer that's either independently swappable (frontend, backend-compute, per the phased migration) or naturally separate (data, secrets, observability):

- **`bootstrap`** — Terraform state storage account + container, and the initial Key Vault. Solves the chicken-and-egg problem (Terraform needs credentials/state storage before it can create everything else). Applied once, separately from routine dev/live deploys.
- **`frontend`** — Static Web App for v1, swapped for AKS ingress + deployment in the later phase. Nothing else depends on which is inside.
- **`backend-compute`** — Function App + plan for v1, swapped for AKS deployment + KEDA `ScaledObject` later. The module the phased-migration plan is built around protecting.
- **`data`** — Cosmos DB account, database, containers (serverless); also the Azure OpenAI (Cognitive Services) account and model deployment used by the AI-advisor Function (added in Milestone 4). Unchanged across both phases. The OpenAI resource lives here rather than in `backend-compute` for the same reason the Managed Identity lives in `secrets` rather than `backend-compute`: `backend-compute` is destroyed and recreated routinely for cost management (see Cost Management below), and a model deployment is exactly the kind of slow-to-reprovision, quota-scarce resource that must survive that teardown.
- **`secrets`** — Key Vault (post-bootstrap), the user-assigned Managed Identity, and its role assignments. Referenced by `backend-compute`, but persists independently of it.
- **`observability`** — Log Analytics workspace + Application Insights for v1; same module later points the OTel Collector at Prometheus/Grafana instead.

### Dev/live parity: separate directories per environment

| Approach | Pros | Cons |
|---|---|---|
| **Terraform Workspaces** (one set of `.tf` files, `terraform workspace select dev/live`, same state backend with workspace-suffixed state) | Less duplication, single source of truth | Easy to apply against the wrong workspace by mistake; weaker isolation; less explicit in CI/CD which env ran |
| **Separate directories** (`environments/dev/`, `environments/live/`, each a small root module composing the shared modules, each with its own state file) | Strong isolation — can't apply dev config against live state; explicit audit trail in CI/CD (the path itself shows the env); environments can diverge slightly without conditional logic cluttering modules | Some duplication in root-module wiring; two places to keep in sync when adding a module |

**Decision: separate directories per environment.** The stronger isolation and clearer audit trail are worth the small duplication cost, and it's the more common pattern in production Terraform repositories — the more portfolio-relevant choice.

---

## Local Development Workflow

| Approach | Pros | Cons |
|---|---|---|
| **Point local Functions at real dev Azure resources** | Simple, no extra tooling | Every local run touches real cloud resources — small cost, and dev data gets cluttered with local test runs |
| **Local emulators** (Azurite, Cosmos DB emulator) | Fully offline, zero cloud cost/risk while developing | Another thing to install/maintain; emulators don't perfectly match real Cosmos behaviour (RU costs, serverless quirks) |
| **Hybrid: emulate Cosmos locally, call real Met Office/Azure OpenAI** | Fast local loop for data-layer changes; real behaviour for the two things that actually need it (no good emulator exists for either anyway) | One extra piece of local setup (the Cosmos emulator) |

**Decision: Hybrid.** Cosmos DB emulator for local data-layer work — avoids burning real RUs on every save-and-test cycle and keeps dev Cosmos data clean of local test noise. Real calls to Met Office DataHub and Azure OpenAI, since faking either convincingly isn't worth building and both have generous-enough free tiers for day-to-day dev use. Azure Functions Core Tools is the local runtime either way (`func start` in VS Code); this decision is only about what's behind it. Local auth to any real resources (Key Vault, dev Met Office/OpenAI keys) goes via `az login`, consistent with the secrets management approach above — no real credentials in local `.env` files.

---

## Notifications (Magic-Link Email)

**Decision: Azure Communication Services (Email).**

Needed to deliver the magic-link/OTP emails specified in the data model (`loginTokens` container). Chosen over a third-party vendor (SendGrid, Postmark, Resend) for the same reason as the rest of the stack: pay-as-you-go pricing based on message count and data volume with no meaningful upfront cost at this project's volume, Terraform-provisionable, and works with Managed Identity rather than introducing a separate API-key relationship to manage as another secret.

---

## Cost Management (Later Phase)

AKS's cost problem for this project isn't traffic — it's that a node is a VM that runs whether or not anything's using it. KEDA scales *pods* to zero, but the underlying node typically keeps running unless node-level autoscaling to zero is also configured, which is extra complexity on top of KEDA itself. Realistic always-on cost for a minimal single-node cluster with a Standard Load Balancer: roughly £45-85/month (node + disk + LB), even fully idle.

**Approach: manual teardown as primary, scheduled teardown as a fallback safety net.**

- **Manual (primary):** `terraform destroy -target=module.frontend -target=module.backend_compute` when not actively using the cluster (after a demo, end of a work session), `terraform apply` to bring it back. A couple of minutes either way. Because `data` and `secrets` are separate, persistent modules, this never touches Cosmos DB, Key Vault, or the user-assigned Managed Identity's role assignments — nothing to re-wire, no permissions admin, no state risk.
- **Scheduled (fallback):** a GitHub Actions workflow on a `cron` schedule (e.g. nightly) running the same targeted destroy, in case the manual step gets forgotten. Safe to run even if already torn down — `terraform destroy` against nothing already gone is a no-op.

This only works cleanly because of two decisions made earlier: the per-layer module split (frontend/backend-compute are the only things ever destroyed) and the user-assigned Managed Identity (permissions persist in `secrets` regardless of whether `backend-compute` currently exists).

---

## Summary: Phase Plan

**v1 (ship first):**
- Frontend: Azure Static Web Apps
- Backend: Azure Functions
- Data: Cosmos DB (serverless)
- CI/CD: GitHub Actions, OIDC to Azure
- Secrets: Azure Key Vault, user-assigned Managed Identity
- Observability: OpenTelemetry → Azure Monitor
- IaC: Terraform, modules per layer (`bootstrap`, `frontend`, `backend-compute`, `data`, `secrets`, `observability`), separate `environments/dev` and `environments/live` root modules

**Later phase (target, once v1 is validated):**
- Frontend + backend: containers on AKS
- Backend autoscaling: KEDA (HTTP-based scale-to-zero)
- Data: Cosmos DB (serverless) — no change needed
- Observability: OpenTelemetry → Prometheus/Grafana (Collector export config change only)
- IaC: `frontend` and `backend-compute` modules swapped internally; `environments/*` structure unchanged
- Cost management: manual `terraform destroy`/`apply` on `frontend`+`backend-compute` between uses, scheduled nightly teardown as fallback — safe because `data`/`secrets` persist independently