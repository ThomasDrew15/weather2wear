---
name: milestone-log
description: Write or update the engineering log entry for a milestone in docs/milestone-N-*.md — what was actually built, what went wrong, how it was diagnosed, final verification against real infrastructure, and what carries forward. Use when a milestone is complete or substantially done, or when the user asks to write up, document, or log a milestone.
---

# Milestone engineering log

The design docs capture *decisions*; this captures *execution*. It is the portfolio artifact — the thing that shows how problems were actually diagnosed, not just that they were solved. Write it so that someone who has never seen the project can follow the reasoning.

File: `docs/milestone-N-<slug>.md`. Read the two most recent existing logs before writing; match their voice rather than inventing one.

## Structure

```markdown
← [README](../README.md)

# Milestone N — Title

**Goal (from the [build order doc](./weather-outfit-advisor-build-order.md)):**
- <the bullets verbatim, with any superseded line struck through and dated>

**Status: complete.** <one line on what is now demonstrably working>

<A framing paragraph: what was actually distinctive about this milestone.>

PRs: [#NN](...) (what it was), [#NN](...) (what it was).

---

## 1..N Numbered sections
## Final verification
## Cost
## Carried into Milestone N+1
```

## What makes these entries worth reading

**Lead with what was distinctive, not with a summary.** Milestone 3's framing was that writing the code took a fraction of the time deploying it did, with five blockers in between. Milestone 4's was the inversion — deployed first time, and the real work was in what verification turned up afterwards. Find the shape of the milestone and say it in the opening paragraph.

**Record how something was diagnosed, not just what the fix was.** The diagnosis is the transferable part. Include the actual error text, the command that revealed the cause, and what the wrong hypothesis was before the right one. "Confirmed via `az functionapp show` rather than inferred" carries more weight than the conclusion alone.

**Write up failures in proportion to what they taught.** Milestone 4's rate limiter shipped bypassable twice and that section is the longest in the entry, correctly — it is where the generalisable lesson lives. A blocker that cost a day and taught nothing gets a paragraph.

**Distinguish real findings from false positives in code review.** Say which review comments were valid, which were wrong, and how the wrong ones were disproved. A false positive that was checked by running the thing is worth recording precisely because trusting it would have been the easier path.

**End lesson-heavy sections with the generalisable rule**, stated so it applies beyond the specific case. "A request header is trustworthy only if a hop you control is known to *overwrite* it" outlives the endpoint it was learned on.

**Correct earlier entries when new evidence contradicts them.** Milestone 1's "push trigger never fires" finding was wrong and got a dated addendum rather than being left standing. Do this inline, dated, never by silent edit.

## Final verification

Show real output from real infrastructure — actual `curl` responses, actual `gh run view` output, actual test counts. Unit tests do not discharge this section.

Where a contract has multiple paths, show that each was exercised, and say which cases were tested against the live deployment rather than only in tests. If a test was rerun because the first version couldn't have failed, say so: a test too slow or too weak to trigger the thing it tests looks exactly like a pass.

## Cost

A short, honest paragraph. What was created, what it actually bills, and what rounds to £0. Include real figures where they exist. Note anything left unapplied by design.

## Carried into Milestone N+1

Every unresolved item, each as a bullet a future reader can act on: open issues with numbers, known flaws with their current workaround, and anything verified in `dev` but never in `live`. Be explicit when something is a workaround rather than a fix.

## After writing

- Update `README.md`'s engineering-log index and status line
- Update `CLAUDE.md`'s current status
- Check that the previous milestone's "Carried into" items are each either resolved here or carried forward again — silently dropping one is the failure mode this section exists to prevent

Report what you wrote and offer to commit. Never invent a verification result, a cost figure, or a command output that was not actually produced.
