# Inbox Triage Backlog

Deferred work from the inbox-triage agent increment (Plan 04-03). Each item was consciously scoped out. The cost/risk of deferral is stated so the trigger condition is unambiguous.

---

## 1. Thread-level human-reply detection

**What it is**

Before the triage workflow classifies a new message, check whether a human has already replied to the same Gmail thread. If the thread has an outbound message not authored by the agent, skip classification and treat the thread as externally handled.

**Current state — what exists and what doesn't**

Same-message idempotency is handled and is not the gap. `GmailPoller.poll()` queries `processed_external_ids` for each message ID before doing anything (`gmail-poller.ts` lines 104–116). If a row exists, the loop `continue`s immediately — no event is persisted, no job is enqueued. A given Gmail message ID can never be processed twice.

The gap is at the thread level. The `triage_seen_messages` table has a `thread_id` column (`packages/db/src/schema.ts`) and `DbTriageStore.writeSeenMessage()` in `packages/engine/src/workflow-runner.ts` populates it after classification. But `thread_id` is never queried before a run starts. `WorkflowRunner.run()` does not check `triage_seen_messages` at all. The workflow itself (`packages/workflows/src/sprigly-inbox-triage/sprigly-inbox-triage.ts`) does not receive or check thread history before calling the model.

This means: if a founder manually replies to a thread in Gmail, the agent has no mechanism to detect it. The next inbound message on that thread will still be classified and produce a `needs_human` entry in the capture log.

**Cost/risk of not having it**

Low today, clearly bounded. The failure mode is noise, not damage: the founder receives a redundant `needs_human` item in their digest for a thread they already handled. The item cannot loop — `processed_external_ids` blocks re-enqueuing. The agent cannot send anything autonomously in this increment, so no duplicate sends are possible.

Slightly worse for escalate-category messages: the founder gets pinged (via the digest or future SMS alert) about a thread they already dealt with. Still not damaging, but higher annoyance value than a redundant draft.

**Trigger to build**

The send-capability increment. Once the agent can send replies, thread-level awareness becomes load-bearing: without it, the agent might draft a reply on a thread where the founder already responded, and that reply could be approved and sent, creating a double-reply. Build detection at the same time as send, not before — it needs to distinguish agent-authored sends from human sends, which has no meaning until sends exist.

**Implementation note for when this is built**

The `thread_id` column in `triage_seen_messages` already exists for this purpose. The query would be: before calling the model, check whether `triage_seen_messages` has any row for `(client_id, thread_id = input.threadId)` with a human-reply indicator. This requires either a Gmail Threads API call per message (to inspect all thread participants) or a separate table tracking agent-sent message IDs so human replies can be inferred by exclusion.

---

## 2. Graduation — per-category auto-send

**What it is**

A per-category state machine that transitions a category from `Review` (agent drafts, human approves every time) to `Auto` (agent drafts and sends without review) after sufficient high-confidence correction history. Offered-not-imposed: the founder opts in per category. Escalation categories (`action: 'escalate'`) are permanently ineligible. Reversible: any new correction on an auto-send category drops it back to Review.

**Current state**

The `graduationEligible` flag exists on every `TriageCategory` in the JSONB schema (`triage_configs.categories`, defined in `packages/engine/src/types.ts:TriageCategory`). It is written to the DB when a config row is seeded. Nothing in the codebase reads it: `WorkflowRunner` doesn't check it, the classify workflow doesn't check it, and the consumer has no concept of a per-category send gate. The flag is present so the field exists in production data when the logic is built.

**Cost/risk of not having it**

None today. Every `needs_human` item requires a human approval step before anything is sent, which is the correct default. Missing graduation means additional founder friction per email as volume grows, but that friction is correctness — not a bug.

**Trigger to build**

After real correction data exists across tenants. Graduation thresholds (e.g. "10 consecutive approvals, 0 corrections in 30 days") cannot be set sensibly without empirical baseline data. Build after the quarterly review cycle (item 3) has produced at least one quarter of capture log data and the correction patterns are understood.

---

## 3. Quarterly policy review + inbox intelligence

**What it is**

Two related surfaces built on `triage_capture_log`:

1. **Mined-pattern loop**: after each quarter's data, surface correction patterns to the founder: "You overrode `invoice → escalate` to `invoice → draft_reply` 4 times in 3 months. Do you want to update the category?" This doubles as a config-hygiene prompt.

2. **Inbox intelligence**: founder-facing dashboard showing email volumes per category, draft→approval conversion rate, new email types that matched no category (classified as `unknown`), and emerging patterns. Doubles as a retention touchpoint — makes the agent's contribution visible in a form the founder can report to stakeholders.

**Current state**

All the underlying data exists. `triage_capture_log` records `category`, `suggested_action`, `decision`, `correction_type`, `final_action` on every resolved item. `correction_type` inference logic is live in `packages/engine/src/resolution.ts`. No analytics layer queries these columns yet.

**Cost/risk of not having it**

Deferred cost is accumulating capture log rows with no feedback cycle. The agent will continue making the same category mistakes if the config isn't updated. In a low-volume mailbox this is minor friction; at higher volume it becomes systematic noise. The config can be updated manually in the interim.

**Trigger to build**

Once a tenant has a full quarter of capture log data with a non-trivial volume of resolved items. The target is enough rows to make the pattern analysis statistically meaningful, and enough tenant diversity to know what the UI needs to surface.

---

## 4. SMS / out-of-band escalation channel

**What it is**

When the agent classifies a message as `escalate`, send an out-of-band alert (SMS or similar) to the founder rather than relying solely on the email staying unread in the inbox. Two-way: the founder can respond with a constrained command grammar (approve/reject/reference number — never free text interpreted as instructions) that maps to agent actions.

**Current state**

Escalation is a `needs_human` item. The consumer does not call `markRead` when `outcome === 'needs_human'` (`apps/worker/src/consumer.ts`) — the email stays unread as a secondary signal. There is no out-of-band channel. The triage workflow sets `suggestedAction: 'escalate'` in `triage_capture_log` but nothing observes that field post-run to trigger an alert.

**Cost/risk of not having it**

Low if the inbox is checked regularly. High if the founder is away from email. An escalated time-sensitive matter (urgent client request, finance deadline) sits unread in the inbox with no escalation path. This is the correct safe default — the alternative (sending unsolicited SMS from day one) is worse. The risk grows with escalation volume and urgency, both of which are currently unknown.

**Trigger to build**

When real tenant data shows that escalation-category emails have time sensitivity that makes inbox-only delivery inadequate. Watch `triage_capture_log` for: high escalation volume, or any founder explicitly requesting this. Do not build speculatively.

**Design constraint for when this is built**

The two-way command interface must use a constrained grammar: predefined responses (`approve`, `reject`, `ref:123`) only. Never accept free-text replies as prompt inputs to the agent — that's a prompt injection surface. The parsing layer must be strict: anything that doesn't match the grammar is ignored with a rejection reply.

---

## 5. Agent-assisted / self-serve triage config onboarding

**What it is**

Two escalating levels of automation for onboarding a new tenant's triage config:

1. **Agent-assisted**: the agent reads a sample of the tenant's historical mail and proposes a draft `triage_configs` row (categories, voice sample, example replies) for human review and editing. Replaces the current fully-manual process.

2. **Self-serve**: the founder describes their inbox in plain language via an admin UI flow; the agent generates and validates a config draft without requiring platform team involvement.

**Current state**

Config is built entirely by hand. For the acceptance test, the `triage_configs` row was constructed manually and inserted via psql. There is no admin UI for editing triage config and no agent tooling to bootstrap it from existing mail. The schema is defined in `packages/db/src/schema.ts:triageConfigs` and the `TriageConfig` / `TriageCategory` / `ReplyExample` interfaces are in `packages/engine/src/types.ts`.

**Cost/risk of not having it**

Manual config is fine at one or two tenants. It does not scale: each onboarding requires a platform team member to understand the client's inbox patterns, write category definitions, and get voice sample text approved. Config quality varies with the person doing it. Self-serve onboarding is a prerequisite for any kind of product-led growth motion.

**Trigger to build**

After enough human-led onboarding audits to know what questions to ask and what prompts to use. The agent-assisted path needs example good configs to train the prompting against. Target: after 3–5 manual onboardings, patterns in category structures and voice descriptions will be visible enough to write a reliable bootstrapping prompt.

---

## 6. Send-observation blind spot (known limitation)

**What it is**

Sprigly does not observe the actual Gmail send. The capture log reflects the review-page state, not what was actually sent. If a founder edits the draft in Gmail before sending, or sends without using the review page, the capture log and read-state can diverge from reality. A draft-reply item approved on the review page (decision = `approved_as_is`, email marked read) records the agent's original draft text as the final artefact — any edits made in Gmail after that are invisible to Sprigly.

**Cost/risk of not having it**

Bounded and clearly understood. The failure mode is weaker correction data: `correction_type` is inferred from review-page edits, not from what was actually sent. Founders who bypass the review page and edit directly in Gmail will show as `approved_as_is` in the capture log even when they made substantive changes. Items may also show as pending in the digest after the founder has already sent the reply from Gmail without using the review page.

**Trigger to build**

Ships with thread-level human-reply detection (item 1) — that is the same thread-scan mechanism needed to detect that a send occurred. Once thread-level detection exists, distinguishing agent-authored sends from human sends becomes possible, and send-observation reconciliation can be layered on top.

---

## 7. Drafting knowledge base (substance-quality upgrade)

**What it is**

Voice samples make drafts sound like the firm; they do not make drafts factually correct. A drafting knowledge base would let the agent answer enquiries with real firm-specific facts (pricing, availability, what the firm does and does not do) rather than only matching tone. Without it, a well-voiced draft can be factually empty or wrong — which is worse than an obviously generic draft because it looks sendable. Per-tenant retrieval over a firm-supplied knowledge source, fed into the classify/draft prompt at triage time.

**Cost/risk of not having it**

Drafts are reviewed by the founder before being sent, so a factually wrong draft is caught at review — the risk is friction and review overhead, not an incorrect send. However, a draft that looks right but is empty of facts may be approved without editing, and the recipient receives a polished non-answer. The likelihood of this grows with draft-acceptance rates: as voice quality improves and founders approve more quickly, the gap between "sounds right" and "is right" becomes the dominant correction type.

**Trigger to build**

After real drafts have been reviewed for at least one quarter and the correction patterns are visible in `triage_capture_log`. If `correction_type = 'substance'` is the dominant correction type (not `voice`), the knowledge base is the correct fix. Build after the quarterly review cycle (item 3) has produced enough data to confirm the diagnosis.
