---
name: milestone-prework
description: Run the design pass for a milestone before any code is written — verify every assumption against the design docs, check platform claims live, resolve carried-forward issues, update the docs, and decompose into GitHub issues. Use when starting a new milestone, when the user says "prework", "pregame", "let's plan milestone N", or before writing the first line of code for a milestone.
---

# Milestone prework

Produce a settled design before any code exists. The output is **doc edits and GitHub issues — never implementation code.** If you find yourself editing anything under `backend/` or `infra/`, you have left prework.

This procedure exists because it keeps paying. Milestone 4's prework found two doc gaps implementation would have papered over; Milestone 5's found four, including a partition key that didn't support the lookup it was chosen for. Milestone 3 skipped straight to building and spent days on blockers that a live quota check would have surfaced in ten minutes.

## 1. Read the target, then read what it depends on

Start with the milestone's entry in `docs/weather-outfit-advisor-build-order.md`, then read every design doc it touches. Do not rely on summaries in `CLAUDE.md` or on the previous milestone's log — read the source.

Also read the previous milestone's **"Carried into Milestone N"** section and every open GitHub issue assigned to this milestone. Those are commitments, not suggestions.

## 2. Treat Milestone 0 lines as assumptions, not decisions

Anything written in Milestone 0 predates everything learned since. A passing implementation note from the original design is an *assumption*; a line with recorded reasoning is a *decision*. Milestone 4's build-order entry said to seed an Azure OpenAI key into Key Vault — written before the Milestone 2 state-leak incident and the identity-only convention that followed, and following it would have caused the exact incident Milestone 2 exists to prevent.

When you deviate: **strike through the original with a dated note explaining why.** Never edit it away quietly. The plan's history is part of what this project demonstrates.

## 3. Verify assumptions against the docs, in writing

Go field by field through anything this milestone touches. The gaps that matter are disagreements *between* documents, which is why reading one at a time misses them:

- Does the data model store everything the API contract consumes, and vice versa?
- Are the permitted values of every enum actually written down somewhere? An allowlist cannot be implemented against an unspecified set — the implementation will invent one and nobody will know.
- Does every container have `schemaVersion`, per CLAUDE.md?
- Does the stated partition key actually support the stated access pattern? A point read needs the partition key in hand, not just the id.
- Is every field that reaches a model prompt constrained? **"The input is structured" is a property of the whole path, not of where the data originally came from** — data that starts at a trusted upstream but transits the client is caller-controlled by the time you see it.

## 4. Check platform claims live before committing to anything

Never design against documentation alone where a command can tell you the truth.

- Quota, SKU and model availability: `az cognitiveservices usage list`, `az quota list`, `az functionapp list-runtimes`, `az cognitiveservices model list`
- Role definitions: `az role definition list --name "<role>"` — read the actual actions rather than trusting the name. Milestone 5 found ACS's only built-in role grants `ListKeys` and `RegenerateKey`
- Provider surface: use the **terraform MCP server** (`search_providers`, `get_provider_details`) rather than fetching registry pages

**Check what a Terraform resource *exports*, not only what it accepts.** Attribute-level key exposure puts a live credential into state with nothing visible in a `plan` diff, and the "Terraform never manages a secret's value" rule does not cover it. Two instances so far: `azurerm_cognitive_account`, `azurerm_communication_service`.

When a third-party blog or forum answer is your only source for a platform behaviour, say so explicitly and raise an issue to test it. Do not launder it into the docs as fact.

## 5. Design the contracts before the code

Request and response shapes go in `docs/weather-outfit-advisor-api-contracts.md` first.

- Reuse the shared error envelope. **Never invent a new error shape**, per CLAUDE.md. If a genuinely new code is needed, add it to the envelope deliberately and say why
- Record the codes you deliberately *didn't* add, and why — an absence that looks like an oversight will be re-litigated later
- Prefer decisions that keep already-verified endpoints unchanged. Making a working endpoint depend on one that doesn't exist yet needs a strong reason

## 6. Threat model the new surface

Add a section to `docs/weather-outfit-advisor-threat-model.md` for boundaries this milestone introduces. For each threat, state the mitigation **or** state plainly that it is accepted, with a named revisit trigger — a milestone, not "later". Accepted risks with triggers are engineering; accepted risks without them are omissions.

## 7. Record the cost of every decision honestly

Every entry should survive a hostile reading. If a choice has a real downside, write it down in the same breath as the choice. "One extra role assignment, and it was a real cost rather than a hypothetical one" is the register to aim for.

## 8. Decompose into GitHub issues

Create issues under the milestone, in build order, at the granularity of a single PR. Match the existing style: a specific title, a short body that says what to do and points at the doc reasoning rather than restating it.

Include issues for things that are *not* implementation: unverified platform claims to test, and a live end-to-end verification issue with a real checklist.

Close any carried-forward issue this prework resolves, with a comment recording the decision and its reasoning — not just "done".

## 9. Update the surrounding docs

- `CLAUDE.md` current status, and any new convention with its reasoning
- The build-order entry, struck through and dated where the plan changed
- `README.md` if the milestone index moved

## Finish

Report what was decided, what gaps were found, and what you deliberately did not change. State plainly that no code was written, and offer to commit. Do not start implementing in the same turn.
