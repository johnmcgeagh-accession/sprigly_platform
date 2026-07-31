/**
 * types.ts — the app/engine contract. PlanPost is the structured post the app
 * reads and (Phase 2+) edits; ShapeRequest/ShapeResult are the agent seam,
 * designed async from the start so Phase 3 isn't a UI rebuild.
 */

export type PostChannel = 'instagram' | 'email';
export type PostFormat  = 'reel' | 'carousel' | 'single' | 'email';
// 'generating' / 'generation_failed' carry an async add-post-with-instruction:
// the post occupies its slot immediately while a shape job writes the caption
// (generating) or after that job failed (generation_failed, instruction preserved
// for retry). Both are transient — they resolve to 'new' on success.
// 'draft' is an UNAPPROVED draft beat (Build A): a proposed slot the client has not
// accepted, not part of the plan. Every plan reader filters it out via
// excludeDraftPosts(), so it should never reach this union in practice — it is a
// member precisely so that if one ever does, the row mapper labels it honestly
// instead of coercing it to 'planned' (see STATUSES in plan.ts).
export type PostStatus  = 'planned' | 'edited' | 'new' | 'generating' | 'generation_failed' | 'draft';

// Regen-merge provenance (migration 0059), orthogonal to `status`. Carried on the
// post so the future orphan accept/remove affordance and the switcher's per-month
// review badges read from one field. null = pre-existing / not yet classified.
export type ReviewState = 'preserved_edit' | 'preserved_edit_orphan' | 'regenerated';

// A production-checklist step on a post (redesign Stage 1). Derivations (due date,
// at-risk, ring) are computed client/server-side from these fields, never stored —
// see app/src/lib/checklist.ts.
export type StepActor = 'agent' | 'user';

export interface PostStepView {
  id:        string;
  label:     string;
  leadDays:  number;
  done:      boolean;
  doneAt:    string | null;   // ISO timestamp, null while not done
  sort:      number;
  createdBy: StepActor;
}

/** A dated content beat (from a cycle's structured_brief.schedule) surfaced on the calendar.
 *  Lightweight + read-only — beats are NOT posts (no format, not editable).
 *  A beat is a RANGE iff `range` is non-null. A range renders ONCE, on `date` — the first
 *  day of its span that is visible in the viewed month (== range.start when the span starts
 *  inside the month; clamped to the month's first day when the span started earlier). `range`
 *  is the FULL, unclipped span, so the pill's suffix and tap always show the true window even
 *  when it began before (or ends after) the viewed month. A single-day beat has `range: null`. */
export interface PlanBeat {
  date:      string;                               // 'YYYY-MM-DD' placement day (the pill renders here, once)
  range:     { start: string; end: string } | null;  // full span for the label suffix + tap; null for single-day
  type:      string;         // beat kind, e.g. 'launch' | 'weekend-style-guide'
  product:   string | null;
  colourway: string | null;
  note:      string;
}

/** The viewed cycle's saved intake, for the capture form to pre-fill (FIX 1). */
export interface PlanIntake { answers: Record<string, string>; freeNotes: string }

/** A compact, human-readable summary of what the extractor took from a freeform brief —
 *  shown in the post-send "here's what we took" feedback moment (Prompt 2). */
export interface ExtractedSummary {
  launches: string[];                               // e.g. "<product> in <colourway> — new" / "<product> — restock"
  dates:    { when: string; label: string }[];      // "25 Aug" | "25–31 Aug" → beat label
  asks:     string[];                               // undated content asks
}

/** The outcome of an intake submit — drives the post-send feedback moment (Prompt 2). */
export interface IntakeResult {
  ok:          boolean;
  mode?:       string | undefined;               // 'brief_updated' | 'proposed' | 'noop'
  extracted?:  ExtractedSummary | undefined;      // present pre-cutoff when a brief was extracted
  beatsReady?: boolean | undefined;
}
/** A client's active durable plan_input (idea/next_cycle) — read-only "remembered" list. */
export interface DurableItemView { id: string; type: string; content: string; createdAt: string }

export interface PlanPost {
  id:          string;
  cycleId:     string;
  clientId:    string;
  channel:     PostChannel;
  date:        string;            // ISO 'YYYY-MM-DD'
  format:      PostFormat;
  pillar:      string;
  caption:     string;
  status:      PostStatus;
  reviewState: ReviewState | null;
  steps:       PostStepView[];   // production checklist, batched in (empty if none)
  hook?:       string | null;    // reel/carousel hook (Stage 6)
  script?:     string | null;
  scriptLengthSeconds?: number | null;  // 15|30|60|90 (Stage 6)
  overlay?:    string | null;
  // Async add-post-with-instruction (carried on source_meta): the instruction that
  // generates/regenerates this post, and the last generation error (if failed).
  pendingInstruction?: string | null;
  generationError?:    string | null;
  /** The monthly AI-change cap refused this post's generation and the work is BANKED (X2c):
   *  stored, and set to run by itself when the allowance resets. Distinct from any other empty
   *  post, because it is the one nothing is currently working on. */
  banked?:             boolean;
  /**
   * When this post goes out, as a LABEL — '06:00', or 'Evening', or null.
   *
   * Spec gap 1, the read half. The value has always existed on `source_meta.postingTime` and
   * no reader surfaced it, so every time in the mockups was the PostingTimes contract's
   * documented example rather than a client's. The live rows hold both clock forms and named
   * slots (see normalisePostingTime), which is why this is a label and not a time.
   */
  postingTime?: string | null;
  /**
   * The slot title the assembler gave this post — 'Wilderness candle relaunch — Launch', or
   * its deterministic fallback form 'Pillar — Format'. Lives on `source_meta.title`, is what
   * the caption instruction names, and had no reader until the card needed a heading that is
   * not just the caption's first sentence repeated above the caption.
   */
  title?: string | null;
  /**
   * Why this post is in the plan — `source_meta.competitorInsight`, the sentence the planner
   * wrote about the slot. Present on every generated post; the sheet puts it behind the
   * insights toggle, and shows no toggle at all when it is empty.
   */
  rationale?: string | null;
}

// ── Draft beats (Build B) ─────────────────────────────────────────────────────
// A draft beat is a PROPOSAL: a slot the assembler suggested and the client has not
// accepted. It is NOT a PlanPost and is deliberately a separate type — a beat has no
// caption, no hook, no script, no checklist, because none of those exist until the
// draft is approved and generation runs (Build D). Modelling it as a PlanPost with
// empty strings would invite exactly the confusion the draft fence exists to prevent.

/** Structured evidence a beat was chosen on. Mirrors BeatRationaleEvidence in
 *  @sprigly/db — restated here so the client bundle does not import the db package. */
export interface BeatEvidence {
  basis:             'observed' | 'template' | 'client_added' | 'client_input' | 'emphasis_reweight';
  reason?:           string;
  formatEngagement?: { format: string; avgEngagement: number; posts: number };
  pillarShare?:      number;
  cadenceBasis?:     { postsPerWeek: number; source: 'observed' | 'config'; months: number };
  candidateRank?:    { rank: number; of: number; origin: 'client' | 'competitor' };
}

export interface DraftBeatView {
  id:       string;
  cycleId:  string;
  date:     string;              // ISO 'YYYY-MM-DD'
  format:   PostFormat;
  pillar:   string;
  title:    string;              // Build A's phrasing, or its deterministic fallback
  position: number;
  slotType: 'proven' | 'experiment';
  evidence: BeatEvidence;
  /** Gaps the assembler flagged. DISPLAY ONLY in Build B — answering them is Build C. */
  assumptions: string[];
}

// ── Month switcher (slice 1) ──────────────────────────────────────────────────
// One qualifying cycle the client may browse. `displayMonth` is derived from the
// EARLIEST live post date (not cycle_month + 1), so it stays correct through any
// future month-resolution change. Only the home cycle is editable; the rest are
// view-only (writes stay scoped to the token's own cycle server-side).
export interface CycleSummary {
  cycleId:                  string;
  displayMonth:             string;   // 'YYYY-MM' from MIN(scheduled_date) of live posts
  monthLabel:               string;   // 'July 2026'
  livePostCount:            number;
  isHome:                   boolean;  // === session.cycleId (the one editable month)
  prePlanning:              boolean;  // cycle status is pre-cutoff → intake capture still open
  preservedEditCount:       number;
  preservedEditOrphanCount: number;
}

// ── Agent seam ────────────────────────────────────────────────────────────────
// Post-level and plan-level shaping both go through applyShape. Structural ops
// resolve synchronously ('applied'); language/regen ops return 'pending' + a
// jobId the client resolves via GET /api/jobs/:jobId. Phase 1 ships neither — but
// the types exist now so later phases bolt on without a rebuild.

export type ShapeScope = 'post' | 'plan';

export interface ShapeRequest {
  scope:        ShapeScope;
  cycleId:      string;
  targetPostId?: string;       // when scope === 'post'
  instruction:  string;
  source:       'web' | 'voice';
}

export type ShapeResult =
  | { mode: 'applied'; summary: string; changedPostIds: string[]; posts: PlanPost[] }
  | { mode: 'pending'; summary: string; jobId: string };

// ── Agent bar (Phase 4) ───────────────────────────────────────────────────────
// The plan-level bar classifies structural-vs-rewrite and routes. Structural →
// 'applied' (sync, free, uncounted). Rewrite/AI-caption → 'pending' + jobIds
// (async, counted). 'blocked' = at the monthly AI-change limit (structural stays
// free). 'noop' = a gentle clarification (nothing applied, nothing spent).

export interface UsageSnapshot {
  used:          number;
  limit:         number;
  overrideUntil: string | null;
  resetsOn:      string;
  unlimited:     boolean;
}

export type AgentResult =
  | { mode: 'applied'; summary: string; changedPostIds: string[]; posts: PlanPost[] }
  | { mode: 'pending'; summary: string; jobIds: string[]; usage: UsageSnapshot }
  | { mode: 'blocked'; summary: string; usage: UsageSnapshot }
  | { mode: 'noop';    summary: string };

// ── Magic-link claims ─────────────────────────────────────────────────────────
export interface LinkClaims {
  clientId: string;
  cycleId:  string;
  exp:      number;            // expiry, epoch ms
}
