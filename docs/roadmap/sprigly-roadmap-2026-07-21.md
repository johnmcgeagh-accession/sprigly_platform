# Sprigly Product Roadmap — consolidated 21 July 2026

## Where the product stands tonight

August 2026 is live for IVY-t on the classic path, tidied and awaiting
Sally's go. The draft-plan arc (Builds A–D + hardening) is complete and
deployed to uat and prod, dark behind `draft_flow_enabled`, proven end to
end on Earl of East (~60–80p per generated month, zero structural drift)
and rehearsed on ivy-t's real data — where it surfaced the exact gaps
listed below before any client saw them. Prod schema is current through
0090. Notification emails send from the operator identity. The go-live
pin remains in place.

The strategic frame (16 July, unchanged): five stages toward a proactive
single-conversation CMO agent — (I) trustworthy agent core → (II) insight
layer → (III) multi-domain data → (IV) strategy memory + gap-driven
intake → (V) proactive CMO. Everything below slots into that arc.

---

## Horizon 1 — Now (this week / next)

**1. Sally's August verdict.** First real client contact with the new
machinery's output (classic path, but structural-merge + hashtag gate
rode along). Her feedback reshapes priorities before anything else runs.

**2. Extraction-contract session** (one build session, spec written by
the rehearsal):
- `beat_spec` intent — "[date] [format] [title]" typed rows apply
  literally, never bounce to ideas
- `cadence` intent — "7 posts a week" overrides observed cadence as a
  slot-count floor (Sally's explicit request; assembler currently
  cannot hear it)
- Scratchpad leak — script/hook generation stores chain-of-thought with
  the deliverable; response contract + extraction + gate check
- Hook/script coherence — script job currently welds a mismatched hook
  on verbatim while narrating the mismatch; decide: script may flag/
  regenerate hook, or hook+script generate together for reels
- Live-classifier verification of `series` (still argued, not
  demonstrated — the standing lesson about argued classifier claims)

**3. Small carried items:** assembly refuses/warns on post-planning-
status cycles; application-level undo (one tap reverts a whole intake
application); per-post explicit posting-time override (the launch-at-7pm
vs `launch→6am` key collision).

---

## Horizon 2 — September: the draft arc's real debut

The milestone: IVY-t's September cycle runs the full new flow — draft at
the Ask touch, Sally reshapes by telling, approves, month generates with
hooks and scripts. Prerequisites, in order:

**1. Data foundation for her draft:**
- Parameterise trawl depth (`resultsLimit`) + one-off deep trawl of
  `ivy_thebrand` on prod (2 rows today; draft needs her real history)
- Fix `mapApifyMediaType` (31/50 posts carry no format — distorts every
  format decision for every client) + re-trawl after
- Pillar weights: derived content-type weights (28/25/20/15/12) vs her
  seven curated message pillars are different taxonomies; decide the
  mapping with Sally or ship equal-split with its honest rationale
- Voice merge: four derived-only rules (second-person address, self-
  deprecating humour, quality-by-subtraction, cost-per-wear) into the
  live profile via voice-profiler, reviewed diff

**2. Brief decomposer** — the headline intake feature. Sally's real
August brief (700 words, 13 intents) is the fixture: document-shaped
input splits into discrete intents, each routed through the existing
classify/apply machinery, itemised receipt ("6 things found: launch ✓ ·
4 style guides ✓ · 2 ideas saved"). Marries `extractStructuredBrief`
(already digests these documents) with Build C routing. Consumes the
series kind, so it follows Horizon 1.

**3. Surface redesign** — design-intent session → phone-reviewed
mockups → build. Locked direction: iOS-native day-focused mobile view
(week strip + single day, per-day add slots), month overview grid
doubling as picker (closes the navigability bug class), beat detail
sheet (rationale + evidence + actions), the reshape moment staged as
visible theatre, draft mode on the calendar not just the list. Brand
system locked: Fraunces display / Inter UI / coral provisional
language.

**4. September runbook** (rehearsed twice now): wipe (targeted SQL) →
status reset → flag → assemble → brief in → review → approve. Plus the
Sally demo runsheet — what she sees, in what order, reshape as
centrepiece.

---

## Horizon 3 — Go-live gates (before the pin comes out)

1. **Delivery pin revert** — the go-live action itself.
2. **Email identity done properly** — `platform@sprigly.co.uk` account,
   prod's own freshly-authorised connection (kills the shared-token
   invalid_grant risk), per-client OAuth reserved for genuinely
   client-identity acts (drafts-in-their-inbox, future inbox
   monitoring). Admin connect-flow affordance (flow exists; no way in
   from a client page — the innerJoin hides exactly the clients who
   need connecting).
3. **Bug 4 / agent tool-use loop** — the standing Stage-I gate: "Talk
   to your plan" must fetch or decline, never confabulate. Bedrock
   native tool use + hardened grounding contract. Blocks Stage II+.
4. **Migration ledger** — drizzle squash to fresh baseline (isolated
   task, clean tree, investigation first) + an applied-log written by
   the apply script so prod audits stop being archaeology. Migration
   file numbering collision (two 0082s) cleaned in passing.
5. **Decisions-in-repo** — banked decisions live in docs/decisions/,
   not chat history (the operator-identity decision was lost for two
   weeks; the §3.9 landmine was mapped and stepped on anyway).
6. **Smoke standard** — post-promotion checks include a structure-diff
   of generated posts vs approved beats, not row counts.

---

## Horizon 4 — The strategic arc (Stages II–V)

**Measurement substrate** (prerequisite for everything below):
`trawl_runs` table; planned↔published join (heuristic date+format now,
Meta Graph API properly at Stage III); graduation loop over it
(experiment → measured → proven/declined, simple engagement-vs-trailing-
average threshold; slow flywheel at n≈3–4 experiments/month — quarters,
not weeks).

**Build E — temperature live.** Allocator exists (resolves all-proven
today); E feeds it real `plan_inputs` candidates, experiment badges with
source-citing rationales, auto-temperature warm start once candidates
exist. Tiered replacement policy already landed.

**Build F — reels transcription + spoken voice.** Trawl captures reel
transcripts (per I-4: video URLs only today, needs download+transcribe
step) → `ig_posts.transcript` → spoken-register facet on the voice
profile → reel scripts ground on how the founder actually talks. Admin
config flags per client (voice intake, reels scripts, temperature).

**Competitor analysis engine.** Standalone handle-in → analysis-out
(format mix, engagement-normalised "what's resonating that you're
not doing"). Pointed at acquisition first (outreach hook, discovery
briefs — pairs with the discovery-brief skill); output lands as
`plan_inputs origin='competitor'` candidates feeding temperature slots.

**Admin onboarding wizard.** Wraps the proven CLI/derivations; v2 mock
is the spec; deliberately last while operator count is one. Onboarding
checklist grows: Gmail/OAuth step, deep trawl, mediaType verification.

**Stage III — multi-domain data.** Meta Graph API (first-party IG
ingestion, replaces Apify dependence and closes planned↔published
properly); Klaviyo read-only; Shopify Admin API (real sales data —
"based on your sales" becomes true; material-facts extraction from
body_html). Sprigly plans email content, never sends it.

**Stage IV — strategy memory + gap-driven intake.** The agent knows
what it doesn't know and asks; voice notes as default founder briefing
channel (transcribe → editable text → extract-gate-apply, the banked
trust model). Blocked on the insight layer existing.

**Stage V — proactive CMO.** The single conversation: "stock of the
linen shirt is high, it converted well in May, nothing's planned —
want a feature post?" Everything above is this stage's supply chain.

---

## Hygiene backlog (real, unglamorous, scheduled opportunistically)

Queue visibility (Bull Board read-only in admin — "is the trawl
running" recurs every cycle) · admin error boundaries per section ·
CLI minimal-deps constructor (env wall hit three times) · db package
test script + `pnpm -r test` exit fix (silent no-op reported false
passes) · Bedrock client wrapper (31 sites enumerated; blocked on the
clientless-audit design decision) · Redis credential rotation ·
remaining de-IVY-t literals (validate-plan "Sally x" example;
AMBIGUOUS_NAMES) · hashtag near-miss correction logging (seeds the
future allowlist) · grounding panel reads probe stamp not
max(updated_at) · plan.ts unknown-status-coercion smell ·
weekly-session sentinel pillar write · `dayOfWeek` never read /
`postsPerMonthMax` unenforced / stale WSG-Saturday config ·
plan_activity FK design note (0090 dropped it; document why) ·
repair-prompt comment distinguishing merge-enforced vs prompt-requested
fields · assembly hard-deletes soft-deleted drafts · Node 22 upgrade
before Jan 2027 (AWS SDK floor) · month-picker until the redesign
lands.

---

## The order, stated once

Sally's verdict → extraction-contract session → data foundation for
ivy-t → decomposer + surface redesign in parallel → September debut →
go-live gates (pin, identity, Bug 4, ledger) → Stage II substrate →
E/F/competitor/wizard as the flywheel builds. The constant test at
every step is unchanged: it must feel like magic to Sally — grounded,
honest, and visibly hers.
