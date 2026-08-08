# Weather Outfit Advisor (Rebuild) — v1 Scope

## Overview
A from-scratch rebuild of the original dissertation project (a web app that recommends clothing based on weather). Not an iteration on the old codebase — new stack, new infra, DevOps-first approach.

## Stack
- **Language:** TypeScript
- **Weather data:** Met Office Weather DataHub (site-specific spot forecast, free tier — 360 calls/day)
- **Cloud:** Azure (fresh infra, built via Terraform), using the standard personal Azure subscription (Pay-As-You-Go) — no separate business email/org setup, not worth the overhead for a portfolio project
- **AI provider:** Azure OpenAI Service, direct (not the full Azure AI Foundry platform layer — unnecessary overhead for a single-model-call use case at this stage). Model: GPT-4o-mini or GPT-5-nano — both cheap enough that cost is a non-issue at this project's scale. Standard subscription access to these models does not require the old Limited Access registration form; only niche/restricted models or content-filter changes do.
- **Orchestration:** AKS (Kubernetes) is the target for the later phase, once v1 is validated — chosen partly because the AKS control plane is free, unlike EKS's flat hourly charge, making it more sustainable to leave running as a portfolio project. **v1 itself runs on Azure Functions + Azure Static Web Apps** (see architecture doc's phased plan) — no AKS in the initial build.
- **IaC:** Terraform
- **Environments:** separate dev and live, with monitoring/observability built in from the start rather than bolted on

## v1 Feature Scope

### Location
- Default to device geolocation
- Manual override via postcode search
- No saved multi-location list yet (that's a lightweight-accounts feature, see below)

### Forecast range
- Today/tomorrow as the baseline requirement
- Extend to multi-day (3–5 day outlook) if the Met Office DataHub integration makes this straightforward — not a blocker for v1 if it adds complexity

### AI advisor
- Inputs: activity type + preferences (dropdowns/structured selects) — same pattern that worked well in the original
- **Free-text context box is explicitly deferred to v2.** Shipping dropdowns-only for v1 avoids taking on prompt-injection/content-safety hardening before the core app is working. When free text is added later, it'll need either structured-prompt + input/output validation, or at minimum length limits and content filtering — to be scoped properly at that point, not bolted on late.

### Accounts / persistence
- **v1:** lightweight accounts — save preferences and locations across visits
- **Target (not v1, but designed toward):** full accounts with auth and saved history/wardrobe, once a DB is in place. Lightweight accounts should be built in a way that doesn't need throwing away when this expands.

## Explicitly Out of Scope for v1
- Free-text AI input (→ v2)
- Full account system with password/OAuth auth / saved wardrobe / history (→ later — magic-link identification and multiple saved locations *are* in v1, see data model doc)

## Resolved Decisions Log
- **Azure vs AWS:** Azure — free AKS control plane vs. EKS's flat hourly charge, plus alignment with existing Az-104/Az-305 certs and current job market demand
- **Azure subscription:** standard personal Pay-As-You-Go, no dedicated business setup
- **AI provider:** Azure OpenAI Service direct, GPT-4o-mini/GPT-5-nano. **Addendum, pregaming Milestone 4 (2026-08-08):** this subscription's Azure OpenAI quota sits on the auto-assigned "Free Tier" (confirmed via `az cognitiveservices usage list` — `gpt-4o-mini` GlobalStandard is 0/0 quota), with an automatic upgrade to Tier 1 scheduled for 2026-08-12 (no business-justification form). Rather than wait, the deployment name is a config value, not hardcoded: start with `gpt-4.1-mini` (200 RPM/200k TPM available now on Free Tier, same non-reasoning chat-completions family as gpt-4o-mini) to prove the AI-advisor pipeline end-to-end, then swap to gpt-4o-mini once Tier 1 unlocks. No API contract change either way — `modelUsed` in the response already just echoes whatever's actually deployed.
- **Concrete architecture, Terraform module structure, monitoring tooling:** all resolved — see the architecture doc
- **Multiple saved locations:** in scope for v1 (not deferred) — the lightweight-accounts data model already supports a `locations` array per user