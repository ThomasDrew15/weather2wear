# Weather Outfit Advisor

A from-scratch rebuild of a dissertation project: a web app that recommends clothing based on weather. New stack, new infra, DevOps-first approach — not an iteration on the old codebase.

**Status:** Milestones 0–2 (due diligence, infra bootstrap, data & secrets) are complete. Milestone 3 (backend compute core) is next. See the [build order doc](docs/weather-outfit-advisor-build-order.md) for the full milestone plan.

## Docs

Design decisions, made before any code was written:

- [v1 Scope](docs/weather-outfit-advisor-v1-scope.md)
- [Architecture](docs/weather-outfit-advisor-architecture.md)
- [Build Order & Milestones](docs/weather-outfit-advisor-build-order.md)
- [Data Model](docs/weather-outfit-advisor-data-model.md)
- [API Contracts](docs/weather-outfit-advisor-api-contracts.md)
- [Threat Model](docs/weather-outfit-advisor-threat-model.md)

## Engineering Log

What was actually built, why, and what went wrong along the way — one entry per milestone. Complements the design docs above rather than duplicating them: those capture *decisions*, this captures *execution*.

- [Milestone 0 — Due Diligence](docs/milestone-0-due-diligence.md)
- [Milestone 1 — Infra Bootstrap](docs/milestone-1-infra-bootstrap.md)
- [Milestone 2 — Data & Secrets](docs/milestone-2-data-secrets.md)
- Milestone 3 — Backend Compute Core *(not started)*
- Milestone 4 — AI Advisor *(not started)*
- Milestone 5 — Accounts Backend *(not started)*
- Milestone 6 — Frontend *(not started)*
- Milestone 7 — Observability & Polish *(not started)*
- Milestone 8 — AKS + KEDA Migration *(later phase, not started)*
