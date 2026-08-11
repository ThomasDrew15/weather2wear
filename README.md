# Weather Outfit Advisor

A from-scratch rebuild of a dissertation project: a web app that recommends clothing based on weather. New stack, new infra, DevOps-first approach — not an iteration on the old codebase.

**Status:** Milestones 0–4 are complete. The weather-fetch and AI-advisor Functions are both deployed to `dev`, serving real Met Office forecast data and real GPT-4.1-mini clothing recommendations. Milestone 5 (accounts backend) is next. See the [build order doc](docs/weather-outfit-advisor-build-order.md) for the full milestone plan.

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
- [Milestone 3 — Backend Compute Core](docs/milestone-3-backend-compute-core.md)
- [Milestone 4 — AI Advisor](docs/milestone-4-ai-advisor.md)
- Milestone 5 — Accounts Backend *(in progress — design complete, see the [API contracts doc](docs/weather-outfit-advisor-api-contracts.md#accounts-endpoints-milestone-5))*
- Milestone 6 — Frontend *(not started)*
- Milestone 7 — Observability & Polish *(not started)*
- Milestone 8 — AKS + KEDA Migration *(later phase, not started)*

## Development tooling

The repo carries its own Claude Code configuration, so the working practices below travel with the code rather than living on one machine.

- [`.claude/skills/milestone-prework/`](.claude/skills/milestone-prework/SKILL.md) — the design pass run before any code is written for a milestone: verify assumptions against the design docs, check platform claims live, record deviations dated rather than editing quietly
- [`.claude/skills/milestone-log/`](.claude/skills/milestone-log/SKILL.md) — the engineering-log format, including the rule that verification output is never invented
- [`.mcp.json`](.mcp.json) — the [Terraform MCP server](https://github.com/hashicorp/terraform-mcp-server), scoped to registry lookups so it needs no token. It reads current provider schemas from the registry, which matters here: this project has been caught three separate times by `azurerm` attribute renames ahead of provider v5.0

**Prerequisite** for the MCP server, resolved via `$(go env GOPATH)` rather than a hardcoded path:

```bash
go install github.com/hashicorp/terraform-mcp-server/cmd/terraform-mcp-server@latest
```
