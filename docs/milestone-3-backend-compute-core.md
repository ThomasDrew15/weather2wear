← [README](../README.md)

# Milestone 3 — Backend Compute Core

**Goal (from the [build order doc](./weather-outfit-advisor-build-order.md)):**
- `backend-compute` module
- Weather-fetch Function against Met Office DataHub, built to the API contract from Milestone 0
- No AI yet — real weather data flowing end-to-end first
- A disposable, internal-only Cosmos smoke-test (create/read/delete against the `users` container, function-key-protected, not part of the public API contract) — proves the Managed Identity's Cosmos RBAC path end-to-end, discharging the verification Milestone 2 deferred until `backend-compute` existed

**Status: open, blocked on an Azure subscription quota increase.** Everything buildable without touching real Azure compute is done, reviewed, and merged. The one thing not yet proven is a real `terraform apply` succeeding in `dev` — see §6.

PRs: [#22](https://github.com/ThomasDrew15/weather2wear/pull/22) (the milestone itself), [#23](https://github.com/ThomasDrew15/weather2wear/pull/23) (a same-day CI fix, see §5). Commits: `12bf06f`, `c16e27e`, `85cd648`, `323870f`, `93973dd`, `2db4781`, `5230cb3`, `425b446`, `1c2e61a`, `aee403b`.

---

## 1. Two design gaps, surfaced before writing code

Pregaming this milestone (talking through the plan before touching Terraform or app code) turned up two real gaps in the Milestone 0 design docs, both resolved before any implementation started, consistent with this project's due-diligence-first approach.

**The accounts/magic-link backend had no milestone at all.** The C4 component diagram and API contracts doc, both written in Milestone 0, only ever named two components inside `backend-compute`: weather-fetch and AI-advisor. The data model doc's `users`/`loginTokens` containers and the magic-link decision were never matched with a corresponding component or contract, so the build order silently had no step that builds them, even though Milestone 5/6 (Frontend, as originally numbered) assumed an accounts backend already existed by then. Fixed by inserting a new **Milestone 5 — Accounts Backend** into the build order, renumbering the old 5/6/7 to 6/7/8, and updating the cross-references in `README.md`, `CLAUDE.md`, the data model doc, and the API contracts doc (commit `12bf06f`). GitHub milestones and issues were updated to match (a new Milestone 5, renumbered 6/7/8, no open issues existed under the old numbers so nothing needed reassigning).

**Milestone 2's Managed Identity verification was left unproven.** The Milestone 2 log explicitly deferred "real token acquisition" to "once `backend-compute` exists to attach it to" — but literal weather-fetch scope never touches Cosmos DB, so that promise would go unfulfilled unless this milestone did something about it. Resolved by adding a small, disposable, internal-only Cosmos smoke-test to this milestone's scope (see §3), rather than either quietly dropping the promise or smuggling the full undesigned accounts feature into a milestone titled "no AI yet, weather data first."

## 2. `backend-compute` Terraform module

Creates, per environment (commit `c16e27e`):
- A Linux Consumption (`Y1`) Function App plan and Function App, attached to the existing user-assigned Managed Identity from the `secrets` module via the `identity` block.
- A dedicated runtime storage account for the Function App's own state (deployment package, trigger bookkeeping), distinct from the app's Cosmos DB. `shared_access_key_enabled = false` and `storage_uses_managed_identity = true` — no master key anywhere, same convention as Cosmos and tfstate storage. This needed a `Storage Blob Data Owner` role assignment for the identity on that storage account specifically (not `Storage Blob Data Contributor`, which is what bootstrap's tfstate access uses — different use case: `AzureWebJobsStorage` identity-based connections specifically require Owner for the blob-lease coordination the Functions host uses internally, confirmed against Microsoft's own docs when a code review questioned it, see §4).
- App settings expose the Key Vault URI, Cosmos endpoint, and the identity's client ID (so `DefaultAzureCredential` resolves unambiguously) — no secret values, consistent with Terraform never managing secret values.

Node runtime was originally set to `20`, matching what seemed like a safe default. Before finishing the module, a real `npm install` locally threw an `EBADENGINE` warning: the current `@azure/*` SDK packages require Node ≥22. Checked what Azure Functions actually supports right now (`az functionapp list-runtimes --os linux`, not assumed): 18/20/22/24 all currently available. Separately, Node 20 hit end-of-life in April 2026 — not just a stale guess, a real reason to avoid it regardless of SDK requirements. Bumped to Node 22 in the module before it was ever applied.

`terraform validate` (not `plan`/`apply` — no real Azure resources touched yet) passed clean in both `dev` and `live` at this point.

## 3. `backend/` Azure Functions app

TypeScript, Azure Functions v4 programming model. Framework-agnostic handlers in `src/handlers/` (plain functions, no Azure Functions types — the code intended to port to a container almost unchanged in Milestone 8) behind thin `src/functions/` registrations (commit `85cd648`).

**weather-fetch:** zod-validated request/response matching the API contract exactly. Before writing the Met Office DataHub integration, pulled a **real** sample response from the live API using the dev Key Vault key (never printed) rather than guessing the shape from documentation — the API contracts doc had already flagged the exact mapping as an open item pending real integration. The real response turned out to be a GeoJSON `FeatureCollection` with day/night `timeSeries` fields and Met Office's significant-weather codes, including an unexpected quirk: the leading `timeSeries` entry can be a partial remnant of an already-mostly-elapsed day (night-only fields, no day fields), which the mapping logic filters out rather than assumes away. Wind speed is in m/s per the DataHub API (confirmed via the openHAB Met Office DataHub binding's channel documentation, since Met Office's own docs page didn't spell out units) and gets converted to mph for the contract. The real sample response is committed as a test fixture (`backend/test-fixtures/metoffice-daily-sample.json`) and used directly in the schema/mapping tests.

Postcode resolution (`location.type: "postcode"` in the contract) needed a geocoding step Met Office's point-based API doesn't provide — this was a genuine gap not covered by any prior design doc. Resolved with postcodes.io (free, unauthenticated, the de facto standard for UK postcode lookups), added to the threat model's external-dependency section afterwards (commit `323870f`) rather than left undocumented.

**cosmos-smoke-test:** internal-only, function-key-protected (never anonymous, since it performs a write), not part of the public API contract. Writes one document to the `users` container with an unmistakable fake id (`smoke-test-<uuid>@internal.invalid`, made unique per invocation after a code review caught a race condition on an earlier fixed-id version, see §4), reads it back, deletes it. This is what actually discharges §1's Managed Identity verification, once it runs successfully against real Azure.

17/17 tests passing (vitest), clean `tsc` build, confirmed with a real local `func start` run (see §4) — none of this has touched real Azure resources yet at this point.

## 4. Three rounds of Copilot review

PR #22 went through three review passes. Worth recording which findings were real and which weren't, since two of the "false positive" cases were only caught by actually testing the claim rather than trusting it.

**Round 1** (3 comments): `deps.now()` called twice in weather-fetch (valid — could disagree across a day boundary, fixed) and a stale `package-lock.json` engines field left at `>=20` after `package.json` was bumped to `>=22` (valid, fixed via `npm install`). The third — `package.json`'s `"main": "dist/src/functions/*.js"` glob "must" be a single entry file — was a **false positive**, verified by actually running `func start` locally: both `weatherFetch` and `cosmosSmokeTest` registered and served correctly. This is documented Azure Functions v4 behaviour (the Node worker parses `main` itself and explicitly supports globs, it's what `func init --typescript` generates by default), not standard Node.js `require()` semantics, which is what the review comment assumed.

**Round 2** (4 comments, "suppressed" by Copilot's own confidence threshold but visible in the raw review): no request timeout on either upstream `fetch()` call in `postcodeResolver.ts`/`metOfficeClient.ts` (valid, fixed with `AbortSignal.timeout()`), the Cosmos smoke-test's fixed document id creating a race condition under concurrent runs (valid, fixed with a per-invocation unique id), and a repeat of the `Storage Blob Data Owner` question from §2 (checked against Microsoft's own docs before touching anything, confirmed correct, left unchanged).

**Round 3** (1 posted "High" + 3 suppressed): zod's raw `.message` leaking into the public `INVALID_REQUEST` error body (valid — verbose, version-unstable internal format, fixed by logging the real issues server-side and returning a fixed message), no `concurrency` group on the new deploy workflow (valid, see §5), and another repeat of the storage-role question (unchanged, already answered). The posted "High" comment — `let periods;` is an implicit `any` under `strict` TypeScript and "should fail `tsc`" — was the **second false positive**, again caught by testing rather than trusting: `tsconfig.json` already had `strict: true` and the build had compiled this exact line clean, unchanged, multiple times already. TypeScript's control-flow analysis ("evolving any") exempts `let x;` from `noImplicitAny` when every read is preceded by an assignment on all branches, which is the case here. The explicit type annotation was added anyway as a zero-cost clarity improvement, not because the claim was correct.

A fourth review was judged not worth requesting: round 3 had already started repeating an already-resolved finding (storage role, raised and answered in round 2) rather than surfacing new ones, a clear diminishing-returns signal.

## 5. CI deploy pipeline, and a same-day fix

`backend-deploy.yml` (commit `93973dd`): dev-only auto `terraform apply` + Function code deploy + post-deploy Cosmos smoke-test check, on push to `main`. `live` stays a manual apply, per the cost-management doc's philosophy of not auto-touching production infra/quota on every merge.

While pregaming this step, re-examining the GitHub Actions run history (prompted by a "was this related to a recent Actions failure?" question) found that **Milestone 1 §5.7's "push trigger never fires" finding didn't hold up**: a push-triggered run had failed on 2026-08-06 with §5.6's already-fixed `listKeys` 403, but at a commit predating that fix, and the very next push-triggered run at the fix commit succeeded, as did a third on the actual PR #11 merge. Push was working; the original "zero runs" finding just wasn't re-checked after later, correctly-triggering pushes happened. Corrected in `milestone-1-infra-bootstrap.md` with a dated addendum (commit `2db4781`) rather than left standing, since this project's engineering log is meant to reflect what's actually true, not what was believed at the time.

**PR #23, same day:** merging PR #22 triggered both `terraform-plan.yml` and `backend-deploy.yml` on the same push (both match `infra/**`). Both target `dev`'s Terraform state. `backend-deploy`'s `terraform apply` lost the state-lock race and failed outright: `Error acquiring the state lock: state blob is already locked, Operation: OperationTypePlan`. Considered `workflow_run` chaining (make `backend-deploy` trigger off `terraform-plan`'s completion) and rejected it: the `workflow_run` event only exposes the aggregate matrix conclusion across both `dev` and `live` legs, so a `live`-only plan failure would incorrectly block a `dev` deploy, working against the deliberate environment-isolation this project has followed everywhere else. Fixed instead with a shared `concurrency` group (`terraform-dev`) across both workflows — concurrency groups are repo-wide, not scoped to one workflow file — keyed by `matrix.environment` in `terraform-plan.yml` so `live` isn't needlessly serialized against unrelated `dev` work. Verified by manually dispatching both workflows at once: `backend-deploy` correctly queued behind `terraform-plan`'s `dev` leg instead of racing it.

## 6. Where it's actually stuck: an Azure subscription quota wall

With the lock race fixed, the dispatched `backend-deploy` run reached `terraform apply` cleanly and failed on something new:

```
401 Unauthorized: Operation cannot be completed without additional quota.
Current Limit (Total VMs): 0
Amount required for this deployment (Total VMs): 1
```

Not a bug in any Terraform or app code. A brand-new Pay-As-You-Go subscription (exactly what this project uses, per the v1 scope doc's deliberate "no separate business setup" decision) defaults to a **regional compute quota of zero** until the account has billing history or an explicit increase is granted — a fraud-prevention measure against stolen-card cloud abuse (crypto-mining, botnets), not a capacity constraint, and it applies even to "serverless" Consumption plans since they still provision from the same underlying regional VM pool. Confirmed with real numbers, not assumed: after registering the `Microsoft.Quota` provider, `az quota list` against `Microsoft.Web/locations/uksouth` showed both the SKU-specific `Y1` quota and the aggregate `Total Regional VMs` (`*`) quota at `0`.

Self-service increase isn't available for this resource type (`az quota update` on `Y1` returned `QuotaNotAvailableForResource`; on `*` it returned `InvalidResourceName`, suggesting the aggregate isn't a directly user-requestable target at all, likely reconciled by Microsoft's fulfillment process alongside whatever specific SKU gets approved). Filing a ticket via `az support in-subscription tickets create` got as far as validating every field correctly (contact details, problem classification, quota payload) before failing on `InvalidSupportPlan: Your support plan type is Free` — ticket creation via the API requires a paid support plan, which this subscription doesn't have. Azure deliberately keeps the **Portal's self-service quota request flow** separate from paid support tickets, so this remains solvable without upgrading anything: submitted via Portal (Help + support → New support request → "Service and subscription limits (quotas)" → Quota type "Function or Web App (Windows and Linux)" → `Y1`, UK South, not zone redundant, new limit 10).

**Status at time of writing: ticket submitted, awaiting Azure's approval.** This is the one open item blocking the milestone from closing.

A related, adjacent finding surfaced while checking whether other upcoming quota walls should be pre-empted: Milestone 4's two candidate models both show `0` TPM quota for the deployment type a live synchronous call would actually use (`OpenAI.GlobalStandard.gpt-4o-mini` and `OpenAI.GlobalStandard.gpt-5-nano`, confirmed via `az cognitiveservices usage list`, distinct from the batch/fine-tune variants of the same models which already have generous quota that isn't relevant to this project's use case). The self-service request path for this one goes through Azure AI Foundry's quota UI rather than the plain Azure OpenAI resource blade, and that flow asks for "company details" and a business justification. Declined for a personal portfolio project rather than misrepresented — left for whenever Milestone 4 actually starts, not blocking anything now.

## Cost

Nothing has actually been created in Azure yet for this milestone (the `terraform apply` that would create it has never succeeded) — the only cost-relevant fact is that this milestone hasn't spent anything, pending the quota approval. Once applied: one Linux Consumption Function App (scales to zero, matching the "near-zero cost when idle" reasoning from the architecture doc) plus one Standard LRS storage account for its runtime state, both billed per-request/per-GB at a scale that should round to effectively £0/month pre-launch, consistent with every other milestone's cost note so far.

## Carried into Milestone 4 (once this closes)

- The Cosmos smoke-test needs to actually pass in CI against real Azure before Milestone 2's Managed Identity verification is genuinely discharged, not just designed to discharge it.
- Milestone 4's Azure OpenAI TPM quota (§6) is a known, already-diagnosed blocker with a declined resolution path — will need a decision (reconsider Foundry's form, or find an alternative) before that milestone can actually call the model, not before it starts.
- `dev`'s `backend-compute` state now exists in Terraform config but not in applied infrastructure — first real `apply` should be watched closely given this is genuinely new ground (no prior Function App has ever been applied in this project).
