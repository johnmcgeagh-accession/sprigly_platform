---
name: sprigly-discovery-brief
description: Research a prospect ahead of a Sprigly discovery call and output a single Sprigly-branded interactive HTML brief. Use this skill whenever John mentions an upcoming discovery call, a Sprigly prospect, a new lead, or asks for prep on a company he's about to speak with — even if he doesn't explicitly say "discovery brief". Also trigger when he supplies a company name and a contact name and asks for research, prep, or background. The skill handles the full research-to-output pipeline and the only deliverable is the rendered widget.
---

# Sprigly discovery call prep brief

A research-and-output skill for prepping John's Sprigly discovery calls. Given a company URL and a named contact, this skill produces one thing: a Sprigly-branded tabbed HTML widget summarising everything John needs to walk into the call prepared.

## What John wants from this

John runs Sprigly. Before every discovery call he needs a structured, evidence-backed read of the prospect: who they are, who the founder is, where their time is going, which Sprigly pipelines fit, what to say in the call, and what could go wrong. He's seen the long-form prose version and chosen the visual widget as the canonical output. The widget is what he actually uses in the call — the research is upstream of that, not a deliverable in itself.

So: do the research thoroughly, then render the widget. Do not output the research as prose. Do not output a markdown brief alongside the widget. The widget is the whole deliverable.

## Inputs to expect

John will give some combination of:
- A company website URL
- A contact name (the decision-maker, usually the founder)
- The industry or vertical
- Occasionally a few notes about how he came across them

If he's missing the URL or contact name, ask once. Otherwise proceed.

## The research phase

Use web_search and web_fetch liberally — this is the part that earns the brief its evidence base. Aim for 10-20 searches across these sources, in roughly this priority:

1. **The company's own site** — homepage, about/our-story, founder page, FAQ, returns/shipping, blog, contact page, product pages. The FAQ and returns pages are gold for operational tells. Product pages reveal pricing and copy patterns.
2. **Companies House** (UK companies) — registered address, incorporation date, accounts type, SIC codes, officer names. Search both `find-and-update.company-information.service.gov.uk` and aggregator sites like endole.co.uk or companycheck.co.uk if the gov.uk page returns thin results.
3. **LinkedIn** — founder background, tenure, prior employers, education. Search for the contact by name + company.
4. **Instagram / Facebook / TikTok / X** — follower counts, post cadence, content style, dormancy signals.
5. **Review platforms** — Trustpilot, Judge.me, Google reviews, Feefo. Look for review count, average score, and themes (slow response? admin friction? sizing? returns?).
6. **Press, podcasts, founder interviews** — search `"<founder name>" podcast OR interview OR press`. These reveal voice, tone, and self-named pain points.
7. **Local/industry context** — pop-up events, collaborations, guest features on other sites.

Be sceptical of third-party revenue estimates (RocketReach, ZoomInfo etc.) — flag them as ceiling-not-gospel if Companies House shows micro-entity status.

Pay special attention to:
- **Names**: confirm the founder's surname spelling from primary sources. If John supplied a different spelling, flag the correction in the brief.
- **Location**: cross-reference registered address against John's location (he's in OX7 / Chipping Norton). If the prospect is local, that's a hook.
- **Self-named pain points**: founder interviews often contain quotes like "I'd put the accounts off till last minute" — these are pure gold. Quote them.
- **Operational tells**: every `contact us for sizing/quotes/availability` line on a product page is a repetitive workflow. Count them.

## Mapping to Sprigly pipelines

Sprigly has four agent roles: **Associate** (research/prep), **Writer** (proposals/updates/reports), **Editor** (QC), **Analyst** (data/reporting). Propose 2-3 specific pipelines, ranked. Each pipeline gets:
- A clear brief-in / work-out shape
- Estimated hours/week replaced
- Specific evidence from the research that justifies it

Pipeline 1 should be the highest-fit, fastest-payback option — usually whatever's eating the most repetitive founder/team hours.

## The output: one widget, Sprigly brand

Read `references/widget-template.md` for the full HTML template, brand tokens, structure, and styling. The widget is the only thing this skill outputs.

Structure (fixed — don't deviate):
1. **Coral header** with sprig mark, "Sprigly · Discovery prep" eyebrow, company name in DM Serif Display, and a one-line subtitle (founder name · positioning · location)
2. **6 stat cards** in a responsive grid — pick the 6 most signal-dense numbers (trading since, team size, follower count, review score, AOV/price band, SKU count, etc.)
3. **6 tabs**: Exec summary · Founder · Ops tells · Pipelines · Call tactics · Risks
4. Within each tab, **digestible cards** with `h3` titles and concise body copy

Brand rules to follow (these are non-negotiable):
- Coral `#E87766` for Pipeline 1 (primary), navy `#1E2A4A` for Pipeline 2 (secondary), amber `#F59E0B` for Pipeline 3 (strategic)
- Plus Jakarta Sans throughout
- DM Serif Display only for: the company name in the header, and the "one question" call-out on the tactics tab
- Coral italic words inside navy text is the signature pattern — use sparingly, for emphasis on customer quotes, name corrections, key framings
- Off-white `#F7F5F0` for stat card backgrounds
- Three-fragment Sprigly close on the call tactics tab: "20 minutes. Free. No pitch."
- Voice in the cards: direct, founder-to-founder, no AI hype. Short sentences. Concrete specifics. Avoid: "seamlessly", "unlock", "empower", "game-changing", "solutions"

## What goes in each tab

**Exec summary** — 4-5 cards covering: what they actually do (not their marketing copy, the real service), local/spelling intel if relevant, revenue model with concrete numbers, what makes them distinctive vs corporate.

**Founder** — 5 cards: background (degree, prior employers as pills, family/founding context), voice & tone (with phrase-level examples), public profile, self-named pain points (with direct quotes where possible), what they care about beyond revenue.

**Ops tells** — 5-6 cards, each one a specific operational sink with an icon. These should read as evidence-backed observations, not speculation. If you can't tie it to something on their site, leave it out.

**Pipelines** — exactly 3 cards, coral/navy/amber-bordered in that order. Each follows the brief-in / trigger / work-out / replaces / why-it-fits structure.

**Call tactics** — 4 cards: three homework hooks (specific things to reference), the one question (in DM Serif Display, coral-bordered), what NOT to mention (amber-bordered), and the navy three-fragment close card.

**Risks** — 5-6 cards covering: vertical fit, price sensitivity, decision-making complexity, trust-pace, scope creep, competitor risk. Be honest — John prefers critical feedback to validation.

## Workflow

1. Confirm inputs (company URL, contact name). Ask once if missing.
2. Research thoroughly — 10-20 web searches across the source priority above. Use search_first behaviour: never answer from priors.
3. Read `references/widget-template.md`.
4. Render the widget via the visualize tool (or equivalent HTML rendering path available in the current environment). The widget code is one tool call; no preamble cards, no markdown brief.
5. After rendering, write one short paragraph (3-5 sentences max) flagging anything that needs John's judgement — spelling corrections, weak evidence, missing data. Nothing else.

## What this skill does NOT output

- No long-form prose brief
- No markdown summary
- No bullet-pointed research notes
- No "here's what I found" preamble
- No restating the widget contents in text
- No follow-up offer to expand on sections

The widget is the answer. Trust it to carry the load.
