# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

> Recorded as `web` per the init rule that mobile web stays `web`. The client surface is a
> Next.js app opened from a magic link on a phone, and it is **deliberately built to read as an
> iOS app** — see Brand Commitments. That is a design commitment, not a platform claim: there is
> no native wrapper and no App Store build.

## Users

**Primary: the founder-owner of a UK D2C product brand.** Non-technical. Runs the brand and
often is the brand — the person in the photos, the voice in the captions. They open a magic link
on their phone, standing up, between other things, and review or reshape a month of Instagram
content that Sprigly has drafted for them. They are not a marketer, they do not know content
jargon, and they did not ask for a tool — they asked for the posts to be handled.

Two live examples, both real clients in this repo: Earl of East (London homeware/fragrance, five
content pillars, 31 posts of history) and ivy-t (womenswear, seven pillars, founder Sally, who
pastes 700-word briefs written as prose).

**Secondary: the Sprigly operator** (John), who runs the admin surface, watches generation, and
fixes what the client should never have to see. Failure states belong to the operator.

## Product Purpose

Sprigly drafts a month of social content for a client, shows it to them with the reasoning
attached, takes their corrections in their own words, and then writes the captions, hooks and
scripts for the month they approved.

Success is a client opening the link, reading a month that is already ~right, saying one or two
things in plain English, and approving. Failure is a client facing a blank form.

## Positioning

**The plan arrives already drafted, and every item can say why it is there.** The client's job is
to react, not to compose. Each planned post carries structured evidence — the format's measured
engagement with its sample size, the pillar's share of their feed, the cadence basis — and the
surface reads that evidence out in templated sentences. Nothing on the plan surface is
model-narrated at render time.

A neighbouring product can generate captions. It cannot truthfully say "carousels average 70
likes and comments across your last 8 posts" unless it measured that client's feed and is willing
to show the sample size.

## Operating Context

- **Phone, one-handed, interrupted.** The review happens in gaps, not at a desk.
- **Magic link, cycle-scoped.** No password. The link lands them on a specific month.
- **A monthly rhythm with a cutoff.** Before the cutoff a month is a draft the client can reshape;
  after it, the plan is committed and posts stay editable by date until each post's own date.
- **Clients talk in prose, not fields.** Sally's August brief was ~700 words containing 14
  separate instructions. The system decomposes it; the client just pastes or says it.
- **Instagram is the destination.** The client's real end action is copying a caption out of
  Sprigly and into Instagram.

## Capabilities and Constraints

**Confirmed capabilities**
- Deterministic draft assembly from the client's own feed history: cadence, format mix, per-format
  engagement, pillar weights.
- One sentence (typed or spoken) reshapes the month; a pasted document is split into its
  instructions and each is routed separately, returning one itemised receipt.
- Structural edits on a draft: move, swap format, add, remove, reorder, restore.
- Approval fans out caption / hook / script generation across the month.

**Constraints that future work must preserve**
- **Rationales are computed evidence, phrased.** Templates over structured fields, never model
  narration. Where a field is absent the sentence gets shorter; it never gets filled in.
- **Sample sizes are stated.** "Carousels do well" and "carousels average 70 across 8 posts" are
  different claims, and only the second is honest.
- **Approval spends money.** It is two taps, never one, and the consequence is stated in counts.
- **Dates and formats stay editable after approval**, right up until each post's own date. Copy
  must never imply the month is locked.
- **Draft beats are fenced out of every plan reader.** A draft is not the plan.

**Terminology (client-facing).** The internal word is never the client word. `beat` → **planned
post**; `generation_failed` / retry → **on its way**; `cycle` → **month**; approve → **ready to
go**. The full table lives in `docs/design/mobile-plan-surface.md` §7 and is binding.

**Undecided, recorded rather than invented**
- Whether format is the client's choice at all after creation (the format control was removed from
  the detail sheet in round 2; three options are ranked in the spec, none chosen).
- Whether voice capture is browser-side (Web Speech, already wired in `IntakeCapture`) or a
  server-side transcription workstream. Round 3 decides voice ships live from day one; the capture
  mechanism is still open.

## Brand Commitments

- **Name and wordmark:** Sprigly. Wordmark set in **Plus Jakarta Sans 800** (the app's `font-logo`
  token). The mark is two curved leaves meeting at a pointed top with a stem below.
- **Voice: warm, plain, honest.** Short sentences. Never marketing-speak, never internal jargon.
  Admit what we assumed and what we could not do. When something failed, say what happens next
  rather than what broke. The copy already carries scars from getting this wrong: an earlier
  approval screen told clients their month was locked when it was not, and the correction is now a
  binding line.
- **It must read as an iOS app, not a website.** This is the single loudest brand commitment on
  the client surface and it drives the typography decision below.
- **Typography (reviewed across three operator rounds — binding):** the **native system stack**
  (`-apple-system`, `BlinkMacSystemFont`, `SF Pro Text`, `system-ui`) for **all** app-surface text,
  including day and date headers, matching the admin surface's sans. **Fraunces does not appear on
  the client app surface.** Fraunces remains available to marketing and to the website; it is out
  of the product.
- **Colour is theme-driven, not hard-coded.** The platform has an admin Themes system: global, one
  active theme, CSS custom properties injected at the layout root, activation gated on AA for
  tint/text pairs. Client surfaces consume tokens; they never name a hex.
- **Anti-references (explicit):** the generic SaaS dashboard; purple-gradient AI slop; the
  competitor's (Stanley) purple; and anything that reads as a website rather than an app.

## Evidence on Hand

Real, in-repo, and used as the only source for anything shown in design work:

- `docs/reports/build-a-draft-assembly.md` §10 — Earl of East's measured engagement: carousels
  69.9 over n=8, single posts 38.2 over n=23, pillar share 0.2 on the `equal` basis, cadence 2.24
  posts/week over 4 months, 31 posts of history. Cross-validated against the Phase 0 SQL.
- `docs/reports/build-d-approval-phase2.md` §1 — the ten approved October posts with their real
  generated captions, hooks and scripts, and zero structure drift through generation.
- `docs/reports/ivy-t-rehearsal-failures.md` — ivy-t's 21 planned posts, real (defective) titles,
  a verbatim receipt with its added/replaced lines.
- `docs/reports/brief-decomposer.md` §COMMIT 4 — Sally's 14-segment brief with each segment's kind
  and outcome.
- `docs/calibration/ivy-t-2026-07/DIFF-SUMMARY.md` — ivy-t's seven configured pillars.

**Absences that must not be fabricated.** No client-facing prompt copy exists in the repo. No
stored `posting_times` value is readable through any API. No live client has an experiment slot.
No client has a recorded thin-data draft. Engagement figures are only ever the reported ones —
inventing a metric is the one unrecoverable failure on this surface.

## Product Principles

1. **React, don't compose.** The month arrives drafted. Every screen is built for a person
   correcting something, not authoring it from nothing.
2. **Say why, with the sample size.** Evidence is the product. A rationale that cannot cite its
   basis is not shown at all.
3. **Their words, not our fields.** One sentence — typed or spoken — is the primary input. Forms
   are the fallback, not the interface.
4. **Show the cost of a change.** Every reshape reports what it added, moved and replaced. A
   summary that hides what it removed is worse than no summary.
5. **The client never does our recovery.** System failure is the operator's problem. The client
   sees work in progress, never an error with a retry button.

## Accessibility & Inclusion

- Theme activation is **AA-gated** in admin on tint/text pairs; a theme that fails cannot go live.
  Design work inherits that gate rather than re-deciding it per screen.
- **Accent colour is never used for small text.** Accent text appears only on the accent-100 tint,
  at the accent-800 tier.
- Touch targets ≥44px on primary actions, ≥40px everywhere else.
- Every icon-only control carries an `aria-label`; state is exposed via `aria-pressed` /
  `aria-selected` / `aria-current`, not colour alone.
- Status is never signalled by colour alone — the "on its way" marker is a different *shape*, not
  just a different hue.
- Users are read-write on a phone one-handed and often in poor light; contrast and target size are
  usability requirements here, not compliance ones.
