← [README](../README.md)

# Milestone 1 — Infra Bootstrap

**Goal (from the [build order doc](./weather-outfit-advisor-build-order.md)):**
- `bootstrap` Terraform module (state storage account + container, initial Key Vault)
- `environments/dev` and `environments/live` scaffolding
- GitHub Actions OIDC connection to Azure, proven end-to-end with a trivial `terraform plan` check in CI

Commits: `140bfa1`, `a9242e4`, `3df6f10`.

---

## 1. Directory structure

```
infra/
  bootstrap/            # applied once, manually, by a human operator
  environments/
    dev/
    live/
```

`bootstrap` is deliberately separate from `dev`/`live` — it creates the things those environments *depend on* (remote state storage, the initial Key Vault), so it can't itself use the backend it's creating. See the architecture doc's [Terraform Module Structure](./weather-outfit-advisor-architecture.md#terraform-module-structure) section for the reasoning.

## 2. Local tooling

Neither Terraform nor `gh` (GitHub CLI) were installed on the machine; Azure CLI already was, and was already logged in to the intended subscription ("Azure subscription 1", Pay-As-You-Go, matching the [scope doc](./weather-outfit-advisor-v1-scope.md)).

- **Terraform**: pulled from Homebrew's `homebrew-core` in 2023 after HashiCorp's license changed to BUSL — installed from HashiCorp's own tap instead: `brew tap hashicorp/tap && brew install hashicorp/tap/terraform`. Landed on v1.15.8, satisfying `required_version = ">= 1.9"`.
- **GitHub CLI**: plain `brew install gh`, needed later for setting repo variables and triggering/inspecting workflow runs without leaving the terminal.
- Both `az login` and `gh auth login` are interactive/browser-based and tied to personal accounts — run by the human operator, not automated.

## 3. `bootstrap` module

Creates, in `rg-woa-bootstrap`:
- A storage account (`stwoatfstatec9gjz3`, name is `st${short_name}tfstate${random_suffix}` — storage account names must be globally unique, hence the random suffix) + a `tfstate` blob container, versioning enabled, `prevent_destroy` set (losing this takes out state for the whole project).
- A Key Vault (`kv-woa-boot-c9gjz3`) — RBAC-authorized, purge protection on, 90-day soft-delete retention set **explicitly** rather than left to provider defaults, per the [threat model doc](./weather-outfit-advisor-threat-model.md#1-key-vault--managed-identity-trust-boundary)'s call to confirm this in Terraform rather than assume it.
- A `Key Vault Administrator` role assignment for the operator's own user (via `data.azurerm_client_config.current.object_id`), since no Managed Identity exists yet to hold vault access — that comes in Milestone 2's `secrets` module.

`bootstrap` itself uses `backend "local"` — it can't point at the remote state store it's the one creating.

### `dev`/`live` scaffolding

Each environment got `versions.tf` (provider pinning), `backend.tf` (azurerm backend block, storage account name filled in from bootstrap's output once it existed), and an empty placeholder `main.tf` — nothing to compose yet until Milestone 2's `data`/`secrets` modules exist.

## 4. GitHub Actions OIDC

The build-order doc's phrasing ("proven end-to-end... in CI") meant this had to actually run successfully in GitHub Actions, not just parse correctly — which is exactly where most of this milestone's real debugging happened (see §5).

**A design gap surfaced before writing any code**: the threat model doc says the CI identity's role assignment should be scoped to "specific resource group(s), not subscription-wide" — but at that point only `rg-woa-bootstrap` existed. Rather than default to subscription-wide Contributor as a stopgap (contradicting the threat model) or block on Milestone 2, the resolution (confirmed with the project owner) was: **pre-create empty `rg-woa-dev` and `rg-woa-live` resource groups inside `bootstrap`**, purely as scoping targets. Milestone 2+ modules deploy into RGs that already exist; CI never needs subscription-wide access at any point.

Built in `bootstrap`:
- `azuread_application_registration` + `azuread_service_principal` — the CI identity itself, no client secret (that's the entire point of OIDC).
- `azuread_application_federated_identity_credential` — the trust relationship. Scoped to one specific repo and branch, not a wildcard, per the threat model's OIDC federation mitigation.
- `azurerm_role_assignment` × 2 — `Contributor` on `rg-woa-dev` and `rg-woa-live` only.

Workflow file: [`.github/workflows/terraform-plan.yml`](../.github/workflows/terraform-plan.yml) — triggers on `push` to `main` (path-filtered to `infra/**`) and `workflow_dispatch`. **Deliberately no `pull_request` trigger** — a fork PR must never be able to run a workflow that authenticates to Azure, per the threat model's second mitigation under OIDC federation. Runs `terraform plan` only; `apply` was never wired into CI.

Repo variables (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`) set via `gh variable set` — **variables, not secrets**, since none of these are sensitive in isolation; they're only useful paired with a valid federated token from this exact repo's own Actions runs.

## 5. What went wrong (and how it was actually diagnosed)

Everything below was found by running the real thing against live Azure/GitHub — plan output alone didn't and couldn't have caught any of it.

### 5.1 — `.gitignore` accidentally excluded the Terraform lock file
`infra/.gitignore` had `**/.terraform.lock.hcl` in it, which is backwards — the lock file pins exact provider versions and *should* be committed; only the `.terraform/` plugin cache shouldn't be. Caught by reviewing the file list before the first commit, not by a failure. **Fix:** dropped that line.

### 5.2 — Provider deprecation warnings
`azurerm_key_vault.enable_rbac_authorization` and `azurerm_storage_container.storage_account_name` both surfaced deprecation warnings on `plan`/`apply` (renamed to `rbac_authorization_enabled` and `storage_account_id` respectively, ahead of provider v5.0 removing the old names). Fixed both — the container one required a live `terraform plan` against already-created infrastructure to confirm it was an in-place attribute swap, not a destroy/recreate, before applying.

### 5.3 — `az login` missing a Graph scope
First `terraform plan` on `bootstrap` failed outright:
```
AADSTS9002313: Invalid request... Interactive authentication is needed.
```
The `azurerm` provider needs a Microsoft Graph token to resolve the operator's object ID for the Key Vault role assignment; the cached CLI session didn't have one. **Fix:** `az login --scope https://graph.microsoft.com/.default` (run by the operator — interactive/browser-based).

### 5.4 — OIDC subject format mismatch (`AADSTS700213`)
The federated credential was written with the classic subject format:
```
repo:ThomasDrew15/weather2wear:ref:refs/heads/main
```
First real CI run failed:
```
AADSTS700213: No matching federated identity record found for presented assertion subject
'repo:ThomasDrew15@64072983/weather2wear@1325907832:ref:refs/heads/main'
```
GitHub's actual OIDC token embeds immutable numeric owner/repo IDs alongside the names — a newer subject format than the one originally written. The numeric IDs from the failure were cross-checked against the real repo (`gh api users/ThomasDrew15 --jq .id`, `gh api repos/.../weather2wear --jq .id`) before trusting them, rather than assumed. **Fix:** added `github_org_id`/`github_repo_id` variables and rebuilt the subject string to match GitHub's actual format. In-place update, confirmed via `plan` before `apply`.

### 5.5 — CI identity couldn't read the state storage account (`403`)
With auth now working, the next failure:
```
403 AuthorizationFailed: ...does not have authorization to perform action
'Microsoft.Storage/storageAccounts/read' over scope '.../storageAccounts/stwoatfstatec9gjz3'
```
The CI identity only had `Contributor` on `rg-woa-dev`/`rg-woa-live` — nothing on the storage account, which deliberately lives in `rg-woa-bootstrap` next to the Key Vault (granting Contributor on that whole RG would've exposed the vault too). **Fix:** two new role assignments scoped to *just* the storage account resource (not the RG): `Reader` (control-plane) and `Storage Blob Data Contributor` (data-plane).

### 5.6 — Still failing after 5.5: `listKeys` (`403`)
```
403 AuthorizationFailed: ...action 'Microsoft.Storage/storageAccounts/listKeys/action'
```
Different in kind from 5.5 — not a missing permission so much as a missing *setting*. Without `use_azuread_auth = true`, the `azurerm` backend defaults to fetching the storage account's **access key** and authenticating with that, ignoring the AD-based roles just granted entirely. This was already a known, deliberately-deferred TODO left in `backend.tf` from earlier in the milestone ("add `use_azuread_auth = true` once this backend is wired up and working") — this failure was that TODO becoming load-bearing. **Fix:** set `use_azuread_auth = true` in both `dev` and `live` `backend.tf`. This also meant the **local operator** needed the same `Reader` + `Storage Blob Data Contributor` roles on the storage account (previously local `init` worked via key-based auth, implicitly available to the subscription owner) — added and verified with a local `terraform init -reconfigure` in both environments before pushing.

### 5.7 — Open item: `push` trigger never fired
The workflow is configured to trigger on `push` to `main` with `infra/**` changes, and did register correctly (`gh workflow list` showed it `active`) — but across three separate pushes touching `infra/**`, zero runs were created via the `push` event (confirmed via `gh api .../actions/runs?event=push` returning `total_count: 0`). `workflow_dispatch` (manual trigger) worked immediately and reliably every time, which is what was used to actually prove the OIDC chain end-to-end (§6). Root cause not identified — Actions is confirmed enabled for the repo (`allowed_actions: "all"`), the workflow YAML is valid (workflow runs fine when dispatched), and there's no obvious permissions gap. **Left as an open item** rather than chased further, since it didn't block the milestone's actual deliverable (an end-to-end-proven `terraform plan` in CI) and further diagnosis would have needed broader `gh` OAuth scopes not yet granted. Worth revisiting before relying on push-triggered CI in Milestone 2+.

## 6. Final verification

```
$ gh run view 31129369723 --repo ThomasDrew15/weather2wear
✓ main Terraform Plan · 31129369723
  ✓ plan (live) in 17s
  ✓ plan (dev)  in 17s
```

Both matrix legs green — OIDC token issuance, Azure AD auth, Terraform backend init, and `plan` all working end to end, exactly as the build-order doc asked for.

## Cost

Everything created this milestone (2 resource groups, 1 storage account, 1 container, 1 Key Vault, 1 Azure AD app registration, 9 role assignments) is either free (resource groups, role assignments, app registrations carry no charge) or billed per-request/per-GB at a scale (a few KB of state, occasional CI runs) that rounds to effectively £0/month. See the conversation-level cost breakdown for the itemized reasoning — nothing here changes that.

## Carried into Milestone 2

- `dev_resource_group_name` / `live_resource_group_name` outputs from `bootstrap` are what the `data`/`secrets` modules will deploy into.
- The `use_azuread_auth` TODO is now resolved; the next related follow-up is setting `shared_access_key_enabled = false` on the storage account once nothing anywhere still needs key-based auth.
- §5.7 (push trigger) is still open.
