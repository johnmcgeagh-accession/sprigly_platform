/**
 * plan-validation.ts — planning validation loop.
 *
 * STAGE 1 (this file): CODE GATE — universal, mechanical, no LLM, per-post.
 * Rejects a post for failures that are wrong for ANY client (no client-specific
 * voice rules live here — those belong to the Stage 2 LLM critic):
 *   - instruction-leak  : bracketed placeholders ([ITEM], [X], [X/X]) or meta-text
 *                         ("leave blank", "see notes"). A caption is finished prose,
 *                         never instructions.
 *   - em-dash           : an em (—) or en (–) dash anywhere in the caption.
 *   - empty-caption     : a blank caption (the prompt now drafts founder posts too;
 *                         whether a blank is ever legitimate is a per-client voice.md
 *                         judgement, so we flag it and let the voice.md-aware
 *                         regeneration fill it or re-confirm).
 *   - invalid-category / invalid-pillar : not in THIS client's client_planning_config
 *                         (config-read, never hardcoded).
 *
 * On failure: regenerate JUST that post with the specific failure as feedback
 * (per-post is cheaper than regenerating the whole plan for one bad post). Max 3
 * retries, then accept-with-warning and log.
 *
 * STAGE 2 (next): the LLM critic runs only on posts that PASS this gate.
 */

import type { ModelClient } from '@sprigly/model-client';
import type { AuditLogger } from '@sprigly/audit';
import type { Logger } from 'pino';
import type { PlanningTracer } from './planning-trace.js';

/** One post row as emitted by the model (JSON). Shared with planning.ts. The two
 *  {contact} edit columns are added blank by the worker, never the model. */
export interface PlanPostRow {
  date?:              string;
  day?:               string;
  title?:             string;
  category?:          string;
  pillar?:            string;
  format?:            string;
  postingTime?:       string;
  whoPosts?:          string;
  competitorInsight?: string;
  draftCaption?:      string;
  notes?:             string;
  /** Set true by the model (which reads voice.md) ONLY when this client writes
   *  this post themselves with no Sprigly draft — then a blank draftCaption is
   *  legitimate and the empty-caption gate does not fire. Not a CSV column;
   *  consumed by the gate and dropped on serialise. The Stage 2 critic can audit
   *  whether the flag was set correctly against voice.md. */
  clientWritesOwn?:   boolean;
}

export interface PostIssue { code: string; detail: string; }

/** This client's authoritative vocab, read from client_planning_config. */
export interface CodeGateVocab {
  categories: string[];
  pillars:    string[];   // pillar NAMES
}

export const MAX_PLAN_RETRIES = 3;

// ── Instruction-leak detection ──────────────────────────────────────────────────
// Tight by design: must catch template placeholders WITHOUT false-flagging
// legitimate bracketed prose (e.g. IVY-t's outfit credits:
// "[ I am wearing our organic cotton Mabel in size 12 - I am a 12/14 ]").

// Bracket whose contents are a placeholder TOKEN: contains an uppercase letter,
// no lowercase letters, bounded length. Matches [ITEM] [X] [X/X] [BRAND NAME];
// does NOT match prose brackets (which contain lowercase) or [12-14]/[🤍] (no A-Z).
const TEMPLATE_BRACKET = /\[[^\]a-z\n]{0,2}[A-Z][^\]a-z\n]{0,28}\]/;

// Bracket whose contents are a known fill-in word as a single token.
const NAMED_PLACEHOLDER =
  /\[\s*(item|items|insert|colou?r|date|name|brand|link|product|price|tbd|placeholder|description|x{1,3}(?:\/x{1,3})*)\s*\]/i;

// Meta-instruction text that should never appear in published prose.
const META_PHRASES =
  /(leave (this )?blank|see notes?|insert (your|the|a)\b|your caption here|add (the )?caption|caption goes here|to be confirmed|\btbd\b|\bplaceholder\b|\[\.\.\.\])/i;

function detectInstructionLeak(caption: string): string | null {
  if (TEMPLATE_BRACKET.test(caption)) return 'contains a placeholder token in brackets (e.g. [ITEM], [X], [X/X]) — write the real words instead';
  if (NAMED_PLACEHOLDER.test(caption)) return 'contains a fill-in placeholder (e.g. [colour], [date], [name]) — write the actual detail';
  if (META_PHRASES.test(caption))      return 'contains meta-instruction text (e.g. "leave blank", "see notes") — a caption is finished prose, not instructions';
  return null;
}

const DASH_RE = /[—–]/;

/**
 * Deterministically remove em (—) and en (–) dashes from caption text, per
 * voice.md ("No em dashes anywhere. Use a comma or full stop instead.").
 *
 * This is the GUARANTEE that the em-dash gate (DASH_RE) almost never has to fire.
 * The trace proved the LLM regeneration was doing nothing but this substitution on
 * 21/21 gate repairs (e.g. "She's here — for everyone" → "She's here, for
 * everyone"), at ~£0.04 a post — so we do it for free, deterministically, and the
 * gate becomes a pure safety net. Applied after generation AND after every repair
 * (the trace showed repairs themselves re-introduce dashes).
 *
 * Substitution rules, in order:
 *   1. Number ranges ("size 10–12", "8 – 10")     → hyphen ("10-12").
 *   2. Any remaining em/en dash (space-padded or not) → comma + space (voice.md's
 *      lead suggestion; matches what the LLM repair did on the traced posts).
 *   3. Tidy the artefacts the substitution can create (", .", " ,", leading ", ").
 * A plain hyphen ("-") is never touched — it is valid (ranges, hyphenated words,
 * the outfit-credit brackets), and the gate never flagged it.
 */
export function normaliseDashes(text: string): string {
  if (!text || !DASH_RE.test(text)) return text;
  return text
    // 1. Numeric range → hyphen (never a comma: "size 10, 12" would be wrong).
    .replace(/(\d)\s*[—–]\s*(\d)/g, '$1-$2')
    // 2. Remaining em/en dash, with any surrounding spaces, → ", ".
    .replace(/\s*[—–]\s*/g, ', ')
    // 3a. Comma now butting a sentence/clause mark ("now, . head" never occurs, but
    //     ", ." / ", ," / ", ;" can): drop the comma, keep the stronger mark.
    .replace(/,\s*([.!?,;:])/g, '$1')
    // 3b. Space before a comma ("word , next") → tight comma.
    .replace(/\s+,/g, ',')
    // 3c. A leading ", " (dash opened the line) → strip.
    .replace(/^\s*,\s*/, '');
}

/** Pure, deterministic per-post check. No LLM, no client-specific voice rules. */
export function codeGateCheck(post: PlanPostRow, vocab: CodeGateVocab): PostIssue[] {
  const issues: PostIssue[] = [];
  const caption = post.draftCaption ?? '';
  const trimmed = caption.trim();

  const leak = detectInstructionLeak(caption);
  if (leak) issues.push({ code: 'instruction-leak', detail: `caption ${leak}` });

  if (DASH_RE.test(caption)) {
    issues.push({ code: 'em-dash', detail: 'caption contains an em (—) or en (–) dash; use commas, full stops, or a spaced hyphen' });
  }

  // Empty caption is a failure UNLESS the model flagged this post as one the
  // client writes themselves (clientWritesOwn) — that is the only legitimate blank.
  // Keying on the model's flag (not whoPosts/pillar) keeps the gate mechanical:
  // the voice.md judgement of "who writes this" stays with the model that read it.
  if (trimmed.length === 0 && post.clientWritesOwn !== true) {
    issues.push({
      code:   'empty-caption',
      detail: 'caption is empty but this post is not flagged as one the client writes themselves. Write a full caption in this client\'s voice. (Only if this client\'s voice.md says the client writes this exact post with no Sprigly draft, set clientWritesOwn to true and leave the caption blank.)',
    });
  }

  const category = (post.category ?? '').trim();
  if (vocab.categories.length > 0 && category.length > 0 && !vocab.categories.includes(category)) {
    issues.push({ code: 'invalid-category', detail: `category "${category}" is not in this client's category list. Use one of: ${vocab.categories.join(', ')}` });
  }

  const pillar = (post.pillar ?? '').trim();
  if (vocab.pillars.length > 0 && pillar.length > 0 && !vocab.pillars.includes(pillar)) {
    issues.push({ code: 'invalid-pillar', detail: `pillar "${pillar}" is not in this client's pillar list. Use one of: ${vocab.pillars.join(' | ')}` });
  }

  return issues;
}

// ── Per-post regeneration ───────────────────────────────────────────────────────

export interface PlanRepairContext {
  vocab:        CodeGateVocab;
  model:        ModelClient;
  modelName:    string;
  audit:        AuditLogger;
  systemPrompt: string;   // the planning system prompt
  userMessage:  string;   // the full assembled plan context
  clientId:     string;
  logger:       Logger;
  logMeta:      Record<string, unknown>;  // channel, cycleMonth, cycleId for logs/audit
  tracer?:      PlanningTracer;            // optional diagnostic trace (never affects behaviour)
}

/** Extract a single post object from a model response (fence/prose tolerant). */
function parseSinglePost(text: string): PlanPostRow {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = (fenced?.[1] ?? text).trim();
  if (!raw.startsWith('{') && !raw.startsWith('[')) {
    const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
    if (a !== -1 && b > a) raw = raw.slice(a, b + 1);
  }
  const parsed = JSON.parse(raw) as unknown;
  const obj = (parsed as { post?: unknown }).post ?? parsed;
  if (Array.isArray(obj)) return (obj[0] ?? {}) as PlanPostRow;
  if (obj && typeof obj === 'object') return obj as PlanPostRow;
  throw new Error('planning repair: response was not a JSON post object');
}

async function regeneratePost(
  post:     PlanPostRow,
  feedback: string,
  ctx:      PlanRepairContext,
  trace?:   { index: number; attempt: number; triggeredBy: 'gate' | 'critic' },
): Promise<PlanPostRow> {
  const fixMessage = [
    ctx.userMessage,
    '',
    '----',
    'One post from the plan above FAILED validation and must be rewritten.',
    '',
    'THE POST (JSON):',
    JSON.stringify(post),
    '',
    'PROBLEMS TO FIX:',
    feedback,
    '',
    'Return the corrected post as a SINGLE JSON object with the same field names. Keep date, day, title, format, postingTime and whoPosts unchanged unless a problem requires changing them (an invalid category or pillar must be replaced with a valid one from this client\'s config above). Output JSON only, one object, no commentary.',
  ].join('\n');

  const result = await ctx.model.complete({
    model:     ctx.modelName,
    system:    ctx.systemPrompt,
    messages:  [{ role: 'user', content: fixMessage }],
    maxTokens: 2000,
  });

  try {
    await ctx.audit.logModelCall({
      clientId:     ctx.clientId,
      modelId:      result.modelId,
      inputTokens:  result.inputTokens,
      outputTokens: result.outputTokens,
      action:       'content-cycle:planning-repair',
      metadata:     { ...ctx.logMeta, title: post.title },
    });
  } catch (auditErr) {
    ctx.logger.warn({ ...ctx.logMeta, err: String(auditErr) }, 'code-gate: repair audit log failed — non-fatal');
  }

  const after = parseSinglePost(result.content);

  // Deterministic em-dash strip BEFORE the caller re-gates. The trace showed repairs
  // re-introduce dashes (a critic fix that adds a "—" then fails the em-dash gate and
  // triggers ANOTHER repair). Normalising here short-circuits that churn loop so a
  // repair is never undone by a mechanical dash the model happened to re-add.
  if (after.draftCaption) after.draftCaption = normaliseDashes(after.draftCaption);

  // Diagnostic trace: the caption before → after, what triggered the repair, and cost.
  if (ctx.tracer && trace) {
    ctx.tracer.repair({
      index:        trace.index,
      title:        post.title,
      attempt:      trace.attempt,
      triggeredBy:  trace.triggeredBy,
      trigger:      feedback,
      before:       post.draftCaption ?? '',
      after:        after.draftCaption ?? '',
      inputTokens:  result.inputTokens,
      outputTokens: result.outputTokens,
      modelId:      result.modelId,
    });
  }

  return after;
}

export interface CodeGateResult {
  rows:                PlanPostRow[];
  checked:             number;
  repaired:            number;   // needed ≥1 regen and ended clean
  acceptedWithWarning: Array<{ index: number; title: string; issues: PostIssue[] }>;
}

/**
 * Run the code gate over every post, regenerating failures in place (max 3
 * retries each), accept-with-warning on anything still failing.
 */
export async function applyCodeGate(
  rows: PlanPostRow[],
  ctx:  PlanRepairContext,
): Promise<CodeGateResult> {
  const out: PlanPostRow[] = [];
  let repaired = 0;
  const acceptedWithWarning: CodeGateResult['acceptedWithWarning'] = [];

  for (let index = 0; index < rows.length; index++) {
    let post   = rows[index]!;
    let issues = codeGateCheck(post, ctx.vocab);
    let didRepair = false;
    ctx.tracer?.gate(index, post.title, 0, issues);   // initial check (attempt 0)

    for (let attempt = 1; attempt <= MAX_PLAN_RETRIES && issues.length > 0; attempt++) {
      const feedback = issues.map((i) => `- ${i.code}: ${i.detail}`).join('\n');
      ctx.logger.info(
        { ...ctx.logMeta, index, attempt, issues: issues.map((i) => i.code) },
        'code-gate: post failed — regenerating',
      );
      try {
        post = await regeneratePost(post, feedback, ctx, { index, attempt, triggeredBy: 'gate' });
        didRepair = true;
      } catch (err) {
        ctx.logger.warn({ ...ctx.logMeta, index, err: String(err) }, 'code-gate: regeneration failed — keeping previous version');
        break;
      }
      issues = codeGateCheck(post, ctx.vocab);
      ctx.tracer?.gate(index, post.title, attempt, issues);   // re-check after this repair
    }

    if (issues.length > 0) {
      ctx.logger.warn(
        { ...ctx.logMeta, index, title: post.title, issues },
        'code-gate: accepted with warnings after retries',
      );
      acceptedWithWarning.push({ index, title: post.title ?? '', issues });
    } else if (didRepair) {
      repaired++;
    }

    out.push(post);
  }

  return { rows: out, checked: rows.length, repaired, acceptedWithWarning };
}

// ════════════════════════════════════════════════════════════════════════════
// STAGE 2 — LLM CRITIC (client-specific). Runs only on posts that pass the gate.
// Judges each post against THIS client's own voice.md + config + historic posts
// + corrections. No hardcoded voice rules. Reuses regeneratePost for failures.
// ════════════════════════════════════════════════════════════════════════════

/** A real published post by this client (from the IG scrape). engagement is used
 *  only to RANK example selection — it is deliberately NOT shown to the critic,
 *  so the critic cannot optimise toward higher-engagement voices (the trap). */
export interface HistoricPost { caption: string; engagement: number; }

/** A draft→correction pair from voice_edits — "what this client considers correct". */
export interface VoiceEditExample { sprigly: string; amended: string; }

export interface CriticVerdict { pass: boolean; issues: string[]; suggested_fix: string; }

export interface CriticContext {
  criticPrompt: string;
  voiceMd:      string | null;
  planConfig:   { pillars: Array<Record<string, unknown>>; categories: string[]; registerMap?: RegisterMap };
  historicPosts: HistoricPost[];
  voiceEdits:   VoiceEditExample[];
  model:        ModelClient;
  modelName:    string;
  audit:        AuditLogger;
  clientId:     string;
  logger:       Logger;
  logMeta:      Record<string, unknown>;
  exampleCount: number;
  tracer?:      PlanningTracer;            // optional diagnostic trace (never affects behaviour)
}

const STOPWORDS = new Set([
  'this','that','with','your','you','from','they','their','have','been','will','what','when',
  'which','about','into','than','then','them','these','those','here','there','just','also','some',
  'more','most','very','over','make','made','like','want','need','each','every','only','because',
]);

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z']{3,}/g) ?? []).filter((t) => !STOPWORDS.has(t));
}

/** Keywords for a pillar, drawn from THIS client's config (name + tagline +
 *  keyMessages + contentIdeas). Client-agnostic: it reads the client's own
 *  pillar definitions, never a hardcoded topic map. */
function pillarKeywords(planConfig: CriticContext['planConfig'], pillarName: string): Set<string> {
  const pillar = (planConfig.pillars ?? []).find(
    (p) => String((p as { name?: unknown }).name ?? '').toLowerCase() === pillarName.toLowerCase(),
  );
  const parts: string[] = [pillarName];
  if (pillar) {
    parts.push(String((pillar as { tagline?: unknown }).tagline ?? ''));
    for (const m of ((pillar as { keyMessages?: unknown[] }).keyMessages ?? [])) parts.push(String(m));
    for (const c of ((pillar as { contentIdeas?: unknown[] }).contentIdeas ?? [])) parts.push(String(c));
  }
  return new Set(parts.flatMap(tokens));
}

export interface HistoricExample { caption: string; sameTopic: boolean; }

/** Pick N historic examples for a post, preferring same-pillar/topic posts
 *  (scored by this client's pillar keywords), filling with the rest as general
 *  voice reference. Engagement only breaks ties — never shown to the critic. */
export function selectHistoricExamples(
  historic:   HistoricPost[],
  post:       PlanPostRow,
  planConfig: CriticContext['planConfig'],
  n:          number,
): HistoricExample[] {
  if (historic.length === 0) return [];
  const kws = pillarKeywords(planConfig, post.pillar ?? '');
  const scored = historic.map((h) => {
    const toks = new Set(tokens(h.caption));
    let score = 0;
    for (const k of kws) if (toks.has(k)) score++;
    return { caption: h.caption, engagement: h.engagement, score };
  });
  const sameTopic = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.engagement - a.engagement);
  const picked: HistoricExample[] = sameTopic.slice(0, n).map((s) => ({ caption: s.caption, sameTopic: true }));
  if (picked.length < n) {
    const used = new Set(picked.map((p) => p.caption));
    const fill = scored
      .filter((s) => !used.has(s.caption))
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, n - picked.length)
      .map((s) => ({ caption: s.caption, sameTopic: false }));
    picked.push(...fill);
  }
  return picked;
}

// ── Authoritative per-category REGISTER map ──────────────────────────────────
// Register (first-person founder "I" vs brand "we/our") is NOT inferred from the
// historic sample — for several post types this client's real feed is register-
// MIXED (e.g. a "Testimonials" or "Educational" topic carries both Sally's "I"
// posts and brand "we" posts), which made the critic oscillate (one verdict
// "use I", the next "use we" on the same post). Register is therefore GROUND
// TRUTH, defined per CATEGORY in client_planning_config.register_map and resolved
// here by a plain category lookup. The critic is told the required register and
// judges against it; for any category NOT in the map it falls back to inferring
// register from historic posts (current behaviour — so register-mixed categories
// such as "Brand" are deliberately left unmapped rather than forced to one voice).
//
// Shape (per-client, self-serve — a client labels each of their categories I/we):
//   { "Sunday Style": "we", "WSG": "I", "Educational": "we", ... }
// A category present here is authoritative; a category absent → null → historic
// fallback. There is intentionally NO blanket default (a default "we" would
// regress I-voice posts filed under a register-mixed category). Adding a safe
// default is the "Brand de-overloading" follow-up: it requires the generator to
// assign register-homogeneous categories first.
export type RegisterMap = Record<string, unknown>;   // { [category: string]: 'I' | 'we' }
export interface ResolvedRegister { register: 'I' | 'we'; category: string; }

/** Resolve the authoritative register for a post by looking up its CATEGORY in
 *  this client's register_map. Returns null when the category is absent/unmapped
 *  — the caller then lets the critic infer register from historic posts (no
 *  regression for register-mixed categories). Defensive: register_map is untyped
 *  JSONB, so the looked-up value is validated before use. */
export function resolveRegister(post: PlanPostRow, registerMap: RegisterMap | null | undefined): ResolvedRegister | null {
  if (!registerMap || typeof registerMap !== 'object') return null;
  const category = post.category ?? '';
  if (!category) return null;
  const r = (registerMap as Record<string, unknown>)[category];
  if (r === 'I' || r === 'we') return { register: r, category };
  return null;
}

/** Human-readable instruction handed to the critic for an authoritative register. */
function requiredRegisterInstruction(r: ResolvedRegister): string {
  const voice = r.register === 'I'
    ? 'the first-person founder "I/my" voice (the founder\'s own voice)'
    : 'the brand "we/our" voice';
  return [
    'REQUIRED REGISTER (authoritative — overrides any inference from the historic posts below):',
    `This post's category is "${r.category}", which this client writes in ${voice}. Judge register (criterion 3 and DECISIVE rule (a)) against THIS rule, NOT against whatever mix the historic posts happen to show. A caption in the opposite voice is a FAIL; a caption in this voice PASSES the register check. The historic posts below are reference for rhythm, vocabulary, structure and sign-off only — do not re-derive register from them.`,
  ].join('\n');
}

/** Tolerant parse of the critic's JSON verdict. On unparseable output, degrade to
 *  PASS (don't block the plan on a critic glitch — the code gate already ran). */
export function parseCriticVerdict(text: string, logger?: Logger, logMeta?: Record<string, unknown>): CriticVerdict {
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    let raw = (fenced?.[1] ?? text).trim();
    if (!raw.startsWith('{')) { const a = raw.indexOf('{'); const b = raw.lastIndexOf('}'); if (a !== -1 && b > a) raw = raw.slice(a, b + 1); }
    const o = JSON.parse(raw) as { pass?: unknown; issues?: unknown; suggested_fix?: unknown };
    return {
      pass:          o.pass === true,
      issues:        Array.isArray(o.issues) ? o.issues.map((i) => String(i)) : [],
      suggested_fix: typeof o.suggested_fix === 'string' ? o.suggested_fix : '',
    };
  } catch (err) {
    logger?.warn({ ...logMeta, err: String(err) }, 'critic: could not parse verdict — passing (degrade, not block)');
    return { pass: true, issues: [], suggested_fix: '' };
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}

export function buildCriticUserMessage(post: PlanPostRow, ctx: CriticContext, examples: HistoricExample[]): string {
  const pillarNames = (ctx.planConfig.pillars ?? [])
    .map((p) => String((p as { name?: unknown }).name ?? '')).filter(Boolean);
  const postView = {
    date: post.date, title: post.title, pillar: post.pillar, category: post.category,
    format: post.format, whoPosts: post.whoPosts, clientWritesOwn: post.clientWritesOwn === true,
    draftCaption: post.draftCaption ?? '',
  };
  const examplesBlock = examples.length > 0
    ? examples.map((e, i) => `${i + 1}. [${e.sameTopic ? 'same pillar/topic' : 'general voice reference'}]\n${truncate(e.caption, 500)}`).join('\n\n')
    : 'None available for this client/month. Judge on voice.md and config only; be lenient on pillar/voice consistency (no historic evidence) and only fail a clear voice.md violation.';
  const editsBlock = ctx.voiceEdits.length > 0
    ? ctx.voiceEdits.map((e, i) => `${i + 1}. DRAFT: ${truncate(e.sprigly, 300)}\n   CLIENT'S AMENDED VERSION: ${truncate(e.amended, 300)}`).join('\n\n')
    : null;
  const resolved = resolveRegister(post, ctx.planConfig.registerMap);

  return [
    'THE POST TO JUDGE (JSON):',
    JSON.stringify(postView),
    '',
    "VOICE — this client's voice.md (their voice rules, sign-off conventions, formatting):",
    ctx.voiceMd ?? '(voice.md not available)',
    '',
    'CONFIG:',
    `Pillars: ${pillarNames.join(' | ')}`,
    `Categories: ${(ctx.planConfig.categories ?? []).join(', ')}`,
    ...(resolved ? ['', requiredRegisterInstruction(resolved)] : []),
    '',
    'HISTORIC POSTS BY THIS CLIENT (how they ACTUALLY write; same pillar/topic preferred):',
    examplesBlock,
    ...(editsBlock ? ['', "CLIENT CORRECTIONS (a draft vs the client's own amended version — what this client considers correct):", editsBlock] : []),
    '',
    'Judge this post now per your instructions. Return JSON only.',
  ].join('\n');
}

async function critiquePost(
  post: PlanPostRow, ctx: CriticContext, examples: HistoricExample[],
  trace?: { index: number; attempt: number },
): Promise<CriticVerdict> {
  const userMessage = buildCriticUserMessage(post, ctx, examples);
  const result = await ctx.model.complete({
    model:     ctx.modelName,
    system:    ctx.criticPrompt,
    messages:  [{ role: 'user', content: userMessage }],
    maxTokens: 800,
  });
  try {
    await ctx.audit.logModelCall({
      clientId:     ctx.clientId,
      modelId:      result.modelId,
      inputTokens:  result.inputTokens,
      outputTokens: result.outputTokens,
      action:       'content-cycle:planning-critic',
      metadata:     { ...ctx.logMeta, title: post.title },
    });
  } catch (auditErr) {
    ctx.logger.warn({ ...ctx.logMeta, err: String(auditErr) }, 'critic: audit log failed — non-fatal');
  }
  const verdict = parseCriticVerdict(result.content, ctx.logger, ctx.logMeta);
  if (ctx.tracer && trace) {
    ctx.tracer.critic(trace.index, post.title, trace.attempt, verdict, {
      inputTokens: result.inputTokens, outputTokens: result.outputTokens, modelId: result.modelId,
    });
  }
  return verdict;
}

export interface CriticResult {
  rows:                PlanPostRow[];
  checked:             number;
  regenerated:         number;
  acceptedWithWarning: Array<{ index: number; title: string; issues: string[] }>;
}

/** Critique every (gate-passing) post; regenerate fails via the shared per-post
 *  path (max 3 retries), accept-with-warning after. A regenerated post is
 *  re-checked mechanically (code gate) before re-critique so a fix can't silently
 *  reintroduce a mechanical fault. */
export async function applyCritic(
  rows:      PlanPostRow[],
  ctx:       CriticContext,
  repairCtx: PlanRepairContext,
): Promise<CriticResult> {
  const out: PlanPostRow[] = [];
  let regenerated = 0;
  const acceptedWithWarning: CriticResult['acceptedWithWarning'] = [];

  for (let index = 0; index < rows.length; index++) {
    let post     = rows[index]!;
    let examples = selectHistoricExamples(ctx.historicPosts, post, ctx.planConfig, ctx.exampleCount);
    let verdict  = await critiquePost(post, ctx, examples, { index, attempt: 0 });

    for (let attempt = 1; attempt <= MAX_PLAN_RETRIES && !verdict.pass; attempt++) {
      const feedback = [...verdict.issues, verdict.suggested_fix].filter(Boolean).join('\n- ');
      ctx.logger.info({ ...ctx.logMeta, index, attempt, issues: verdict.issues }, 'critic: post failed — regenerating');
      try {
        post = await regeneratePost(post, `Voice / consistency problems to fix:\n- ${feedback}`, repairCtx, { index, attempt, triggeredBy: 'critic' });
        regenerated++;
      } catch (err) {
        ctx.logger.warn({ ...ctx.logMeta, index, err: String(err) }, 'critic: regeneration failed — keeping previous version');
        break;
      }
      // Mechanical re-check first — never accept a regen that broke the code gate.
      const gateIssues = codeGateCheck(post, repairCtx.vocab);
      ctx.tracer?.gate(index, post.title, attempt, gateIssues);   // post-repair mechanical re-check
      if (gateIssues.length > 0) {
        verdict = { pass: false, issues: gateIssues.map((i) => `${i.code}: ${i.detail}`), suggested_fix: '' };
        continue;
      }
      examples = selectHistoricExamples(ctx.historicPosts, post, ctx.planConfig, ctx.exampleCount);
      verdict  = await critiquePost(post, ctx, examples, { index, attempt });
    }

    if (!verdict.pass) {
      ctx.logger.warn({ ...ctx.logMeta, index, title: post.title, issues: verdict.issues }, 'critic: accepted with warnings after retries');
      acceptedWithWarning.push({ index, title: post.title ?? '', issues: verdict.issues });
    }
    out.push(post);
  }

  return { rows: out, checked: rows.length, regenerated, acceptedWithWarning };
}
