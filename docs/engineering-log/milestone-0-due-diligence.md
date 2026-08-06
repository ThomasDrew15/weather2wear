← [Engineering Log](./README.md)

# Milestone 0 — Due Diligence

**Goal (from the build order doc):** have a complete, reviewed design before writing any application code.

This milestone was entirely design work — no code, no infrastructure. The output is five documents rather than a narrative log entry, so this page just indexes them instead of duplicating their content:

- [v1 Scope](../weather-outfit-advisor-v1-scope.md) — feature scope, what's explicitly deferred to v2, resolved decisions log
- [Architecture](../weather-outfit-advisor-architecture.md) — the phased v1 → AKS plan, and the reasoning behind every major stack choice (Functions vs. AKS, Cosmos serverless, Key Vault + user-assigned Managed Identity, GitHub Actions + OIDC, Terraform module structure, cost management)
- [Data Model](../weather-outfit-advisor-data-model.md) — Cosmos DB container shapes, partition key strategy
- [API Contracts](../weather-outfit-advisor-api-contracts.md) — request/response shapes for weather-fetch and AI-advisor Functions, shared error envelope
- [Threat Model](../weather-outfit-advisor-threat-model.md) — the four trust boundaries and their mitigations, referenced repeatedly during Milestone 1's build (see [Milestone 1](./milestone-1-infra-bootstrap.md))

**Why this milestone exists as its own step:** the project's explicit goal is demonstrating good engineering practice, not just shipping a working app (see [CLAUDE.md](../../CLAUDE.md)). Front-loading design decisions means Milestone 1 onward builds against settled contracts rather than discovering them ad hoc mid-implementation — and in practice, Milestone 1 leaned on the threat model doc directly and repeatedly (OIDC subject scoping, RBAC over master keys, least-privilege role assignments).

Committed in `c96a2da`.
