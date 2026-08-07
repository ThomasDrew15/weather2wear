← [README](../README.md)

# Milestone 2 — Data & Secrets

**Goal (from the [build order doc](./weather-outfit-advisor-build-order.md)):**
- `data` module (Cosmos DB, serverless)
- `secrets` module (Key Vault + role assignments)
- Managed Identity wiring, provable in isolation before any app code depends on it

---

## 1. `data` module

Creates, per environment (`rg-woa-dev` / `rg-woa-live`):
- A Cosmos DB account, `EnableServerless` capability, `Session` consistency — pay-per-request, no always-on cost, matching the reasoning for Functions over AKS in v1 (see [architecture doc](./weather-outfit-advisor-architecture.md#data-layer-lightweight-accounts--preferences--locations)).
- `local_authentication_enabled = false` on the account — no master key, ever. Data-plane access is exclusively via a Cosmos SQL role assignment tied to the app's Managed Identity, per the [threat model doc](./weather-outfit-advisor-threat-model.md#3-cosmos-db-access-patterns)'s mitigation ("Prefer Cosmos DB's Azure AD/RBAC data-plane access... over master keys").
- `users` container, partition `/email`.
- `loginTokens` container, partition `/email`, `default_ttl = -1` — TTL enabled at the container level with no blanket default, so only items that set their own `ttl` field expire, matching the shape in the [data model doc](./weather-outfit-advisor-data-model.md#container-logintokens).

## 2. `secrets` module

Creates, per environment:
- A Key Vault distinct from `bootstrap`'s (that one only ever existed to hold Terraform's own bootstrap-phase secrets). RBAC-authorized, soft-delete + purge protection set explicitly, same as `bootstrap`.
- The user-assigned Managed Identity itself (`id-woa-dev` / `id-woa-live`) — created once here, referenced by `backend-compute` in Milestone 3, persists independently of it.
- `Key Vault Secrets User` (read-only) for the app identity — the app only ever reads secrets.
- `Key Vault Secrets Officer` for the operator, scoped to this vault only — narrower than `bootstrap`'s "Key Vault Administrator", since this vault never needs access-policy or purge management, only secret read/write.
- A Cosmos DB SQL role assignment (`azurerm_cosmosdb_sql_role_assignment`, not `azurerm_role_assignment` — Cosmos's data plane has its own separate RBAC system) granting the app identity Built-in Data Contributor, scoped to the database.

Secret **values** are deliberately not managed by Terraform at all — see §4.

## 3. What went wrong (part one — a provider deprecation, same shape as Milestone 1)

`terraform validate` flagged `azurerm_cosmosdb_account.local_authentication_disabled` as deprecated in favour of `local_authentication_enabled` (inverted boolean), ahead of provider v5.0 removing the old name — the same category of issue as `enable_rbac_authorization` in Milestone 1. Fixed before ever running `plan`, since `validate` caught it for free this time.

## 4. What went wrong (part two — the real issue)

`dev` was applied cleanly: 11 resources, Cosmos account + containers, Key Vault, Managed Identity, role assignments, and a `azurerm_key_vault_secret` resource holding the Met Office DataHub API key, sourced from a Terraform variable.

That last part was the mistake. **Because Terraform was managing the secret's `value` attribute directly, the real key got written into Terraform state** — not just into Key Vault. Terraform tracks every attribute of every resource it manages in state, to diff against on future runs; a secret's value is just another tracked attribute to Terraform. The state file itself became sensitive material as a result, whether or not that was ever the intent.

This wasn't caught by `plan` or `validate` — both succeed happily either way, since it's a design choice, not a syntax error. It surfaced from a direct question during review: *"I'm thinking about this being public, would we not be leaking an API key?"* Investigation confirmed:
- The `.terraform/terraform.tfstate` pointer file (the one visible locally) only holds backend connection config — not resource attributes, not the secret. Not the leak vector.
- The actual state, including the real key value, lives only in the remote blob (`dev.terraform.tfstate` in `stwoatfstatec9gjz3`), which is Azure AD RBAC-gated (`Reader` + `Storage Blob Data Contributor`, scoped to just that storage account) — not public, not in git. No active leak. But the *design* meant that storage account had become something that exposes a real credential if its access control were ever misconfigured, not just infra state.

**Fix:**
1. Removed the `azurerm_key_vault_secret` resource from the `secrets` module entirely, along with the `met_office_api_key` variable from the module and both environments.
2. `terraform state rm module.secrets.azurerm_key_vault_secret.met_office_api_key` against `dev`'s already-applied state — the secret stays in Key Vault untouched; only Terraform's tracking of it is removed.
3. Real values are now seeded directly via `az keyvault secret set --vault-name <vault> --name <secret> --value <value>` — a manual, one-time-per-value step, documented rather than declared. Terraform manages the vault, the identity, and access — never a value.
4. Removed the now-unneeded `MET_OFFICE_API_KEY` GitHub Actions secret and the `TF_VAR_met_office_api_key` wiring in `terraform-plan.yml` (added, then removed again within the same milestone once the design changed — net diff on that file is zero).
5. Deleted the local `terraform.tfvars` that had briefly held the real key on disk (git-ignored throughout, never at risk of being committed, but no longer needed once Terraform stopped consuming it).
6. Documented the decision durably: a new "How secret values get into Key Vault" subsection in the [architecture doc](./weather-outfit-advisor-architecture.md#how-secret-values-get-into-key-vault), and a CLAUDE.md convention line — so Milestone 4's Azure OpenAI key follows the same pattern without re-deriving it.
7. The Met Office key was rotated and reseeded into `dev`'s vault via the `az` command above, confirmed via `az keyvault secret list-versions` (two versions present, metadata only — never inspected the value itself to verify).

**Left as a deliberate non-fix:** the tfstate storage account has blob versioning enabled (from Milestone 1), so the state blob version written by `dev`'s original apply still contains the pre-rotation key, even after the `state rm`. Decision: leave it — once the key is rotated, that old value is worthless to anyone who might see it, so purging old blob versions would be cleanup for its own sake rather than closing a real exposure. Same "accept it, the risk is genuinely gone" reasoning the threat model doc already uses elsewhere, just applied to a new case.

## 5. Managed Identity, "provable in isolation"

The build order's phrasing asks for the identity to be provable before any app code depends on it. A user-assigned identity normally only acquires a token when attached to running Azure compute, and `backend-compute` doesn't exist until Milestone 3 — so a real end-to-end token-acquisition test isn't possible yet. What's actually provable now, and was checked directly against Azure rather than assumed from `plan` output: the identity exists, and its role assignments resolve to the expected scopes (Key Vault Secrets User on the vault, Cosmos Built-in Data Contributor on the database) via `az role assignment list` / `az cosmosdb sql role assignment list`. Real token acquisition is a Milestone 3 verification, once `backend-compute` exists to attach the identity to.

## 6. Final verification

```
$ terraform plan   # dev
No changes. Your infrastructure matches the configuration.

$ terraform apply  # live
Apply complete! Resources: 10 added, 0 changed, 0 destroyed.
```

`dev`: 11 resources originally applied, now 10 tracked (the removed secret resource) plus the vault holding the rotated key out-of-band. `live`: 10 resources applied; its vault was seeded with the same Met Office key as `dev` (copied directly vault-to-vault via the CLI, value never passed through any visible output) rather than left empty.

**Deliberate trade-off, not an oversight:** `dev` and `live` sharing one Met Office key means dev/CI traffic and live traffic draw from the same 360-calls/day quota — exactly the risk the threat model doc already names under "External dependency failure / edge cases" ("Add OTel-based monitoring of daily call volume so dev/CI traffic doesn't silently eat into the same quota as production"). Decision: accept it for now, since there's no real traffic on either environment yet, and revisit — either a second Met Office registration for `live`, or the OTel call-volume monitoring the threat model already calls for — before Milestone 6 or whenever real usage starts.

## Cost

Two Cosmos DB accounts (serverless, pay-per-request), two Key Vaults, two Managed Identities, a handful of role assignments. Role assignments and identities are free; serverless Cosmos and Key Vault operations are billed per-request at a scale (near-zero request volume pre-launch) that rounds to effectively £0/month, consistent with the reasoning in the [architecture doc's Data Layer](./weather-outfit-advisor-architecture.md#data-layer-lightweight-accounts--preferences--locations) and [Milestone 1's cost note](./milestone-1-infra-bootstrap.md#cost).

## 7. Post-review fix: operator role assignments coupled to the caller, not a stable identity

GitHub Copilot's PR review flagged that `operator_kv_secrets_officer` (this milestone) and `bootstrap_operator` (Milestone 1) both bind `principal_id` to `data.azurerm_client_config.current.object_id` — a live lookup of whoever is currently authenticated, not a stored value. `principal_id` is `ForceNew` on `azurerm_role_assignment`, so a different identity running `terraform apply` (a different machine, a teammate, a CI-driven apply) would silently replace the assignment, revoking the previous operator's access as a side effect of an unrelated run.

**Fix:** added an `azuread_group.operators` (plus `azuread_group_member` for the current operator) to `bootstrap`, and repointed all four affected role assignments — bootstrap's Key Vault Administrator, bootstrap's two tfstate storage account roles, and both environments' Key Vault Secrets Officer — at the group's object ID instead. Membership is now a separate concern from the resources that depend on it; adding or removing an operator is a group-membership change, not an infrastructure change.

Two things worth recording because they were real, not hypothetical:
- **`azuread_group` creation failed mid-apply** on `bootstrap` with `dial tcp [ipv6-addr]:443: connect: no route to host` reaching Microsoft Graph's beta endpoint — a transient network issue, not a config error. Landed in a genuinely bad intermediate state: the old individual-principal role assignments had already been destroyed (they're replaced *before* the new group exists, since Terraform can't know the group's future ID ahead of creating it) while the new ones weren't yet created, meaning the operator briefly had zero access to bootstrap's vault and the tfstate storage account. A plain retry picked up cleanly from state and finished correctly. Worth knowing this ordering risk exists before running this kind of change against anything with less tolerance for a few minutes of degraded access.
- **RBAC propagation delay, for real this time** (previously only a documented possibility): after bootstrap's apply, `dev`'s `terraform plan` failed twice with `403 AuthorizationPermissionMismatch` against the tfstate storage account before succeeding on retry, a minute or so later. Same category of issue as Milestone 1's §5.5/5.6, just triggered by a role assignment being *replaced* rather than newly granted.

Verified post-fix via `az ad group member list` and `az role assignment list` against all three vaults directly, not inferred from `plan` output.

## Carried into Milestone 3

- `module.data` and `module.secrets` outputs (`cosmos_account_endpoint`, `identity_id`, `identity_client_id`, `key_vault_uri`, etc.) are what `backend-compute` will consume to wire the Function App's identity block and app settings.
- Real token-acquisition proof for the Managed Identity (§5) happens once `backend-compute` exists to attach it to.
- `dev`/`live` sharing one Met Office key (§6) — revisit with a second registration or OTel call-volume monitoring before real traffic exists on both.
