/**
 * weekly-audit.ts — the weekly session's Pass 1 (AUDIT) logic, kept pure/testable
 * and free of DB + generation.
 *
 * Weather thresholds live HERE (in code), not in the prompt: the forecast is
 * pre-classified into notable flags and only those are described to the model, and
 * weather_opportunity findings are dropped in code unless a notable flag is set.
 * An unremarkable week with no maturing notes therefore produces zero findings.
 */
import type { ModelClient } from '@sprigly/model-client';
import type { DailyForecast } from '@sprigly/weather';

export type FindingType = 'clanger' | 'weather_opportunity' | 'note_integration' | 'date_conflict';
export type FindingSeverity = 'fix' | 'suggest';

export interface Finding {
  type: FindingType;
  severity: FindingSeverity;
  postId?: string | null;
  noteId?: string | null;
  toDate?: string | null;   // date_conflict: the corrected date (ISO 'YYYY-MM-DD')
  trigger: string;          // verbatim specific reason citing the forecast/note/date
}

// ── Weather thresholds (IN CODE) ──────────────────────────────────────────────
export const NOTABLE_HEAT_C = 27;    // >= max temp
export const NOTABLE_COLD_C = 2;     // <= max temp
export const HEAVY_RAIN_PCT = 70;    // >= precip probability

export interface WeatherFlags {
  notableHeat: boolean;
  notableCold: boolean;
  heavyRain: boolean;
  storm: boolean;
  snow: boolean;
  any: boolean;
  /** Human-readable per-day flag lines for the prompt (only notable days). */
  lines: string[];
}

export function buildWeatherFlags(forecast: DailyForecast[]): WeatherFlags {
  const flags: WeatherFlags = { notableHeat: false, notableCold: false, heavyRain: false, storm: false, snow: false, any: false, lines: [] };
  for (const d of forecast) {
    const day: string[] = [];
    if (d.tempMax >= NOTABLE_HEAT_C) { flags.notableHeat = true; day.push(`hot (${Math.round(d.tempMax)}°C)`); }
    if (d.tempMax <= NOTABLE_COLD_C) { flags.notableCold = true; day.push(`cold (${Math.round(d.tempMax)}°C)`); }
    if (d.precipProbability >= HEAVY_RAIN_PCT) { flags.heavyRain = true; day.push(`heavy rain (${d.precipProbability}%)`); }
    if (d.category === 'storm') { flags.storm = true; day.push('storm'); }
    if (d.category === 'snow') { flags.snow = true; day.push('snow'); }
    if (day.length) flags.lines.push(`${d.date}: ${day.join(', ')}`);
  }
  flags.any = flags.notableHeat || flags.notableCold || flags.heavyRain || flags.storm || flags.snow;
  return flags;
}

export interface AuditPost { id: string; date: string; channel: string; text: string }
export interface AuditNote { id: string; content: string; relevantFrom: string | null; relevantTo: string | null }

export interface AuditInput {
  weekStart: string;
  weekEnd: string;
  posts: AuditPost[];
  notes: AuditNote[];
  flags: WeatherFlags;
  cycleDates: string[];   // known brand/cycle dates (launches, restocks) in the week
}

export const WEEKLY_AUDIT_SYSTEM_PROMPT = `You audit ONE upcoming week of a clothing brand's content plan. You do NOT write or rewrite any content — you only report findings for a human to review. Be conservative: an unremarkable week must produce an EMPTY findings list.

Finding types:
- "clanger": a concrete error in an existing post — a wrong/contradictory date reference, an off-brand or incorrect claim, or content that clashes with the actual forecast (e.g. a caption about a sunny picnic on a day flagged heavy rain). Reference the postId.
- "weather_opportunity": a NEW standalone post prompted by a notable weather flag that week — one that ties the conditions to a genuine brand benefit (e.g. natural fibres like organic cotton or linen in a heatwave; warmth and layering in a cold snap). Only the flags listed are notable — never invent weather. No postId.
- "note_integration": an active note that should shape a specific existing post this week. Reference the postId and the noteId.
- "date_conflict": a post scheduled on/around a known cycle date where the timing is wrong (e.g. a launch-day post scheduled the day after the launch). Reference the postId and give "toDate" (ISO 'YYYY-MM-DD') — the corrected date.

Each finding: { "type", "severity": "fix" | "suggest", "postId"?, "noteId"?, "toDate"?, "trigger": "one specific sentence citing the exact forecast day / note / date that triggered it" }.

Rules:
- Only raise weather_opportunity when a notable weather flag is present in the input. If no flags are listed, raise none.
- When a notable weather flag IS present, you SHOULD raise a weather_opportunity for a new post — even if you also raise a note_integration or clanger on an existing post. A standalone weather post and an edit to an existing post are complementary, not alternatives; do not fold the weather angle into an existing-post edit instead of proposing the new post.
- A note_integration or clanger whose trigger cites the weather should say so in its trigger, so the rewrite reflects those conditions.
- Only raise note_integration for a note actually listed in ACTIVE NOTES, and cite its id.
- Every finding's trigger must cite the specific forecast day, note, or date — no vague findings.
- If nothing is wrong and nothing matures this week, return {"findings": []}.

Output ONLY: {"findings": [ ... ]}`;

export function buildAuditUserMessage(input: AuditInput): string {
  const posts = input.posts.length
    ? input.posts.map((p) => `- id=${p.id} | ${p.date} | ${p.channel}\n  ${p.text.replace(/\n+/g, ' ').slice(0, 400)}`).join('\n')
    : '(no posts this week)';
  const notes = input.notes.length
    ? input.notes.map((n) => `- id=${n.id} | ${n.relevantFrom ?? '…'}–${n.relevantTo ?? '…'} | ${n.content}`).join('\n')
    : '(no active notes maturing this week)';
  const weather = input.flags.any ? input.flags.lines.map((l) => `- ${l}`).join('\n') : '(no notable weather this week)';
  const dates = input.cycleDates.length ? input.cycleDates.map((d) => `- ${d}`).join('\n') : '(none)';
  return `WEEK: ${input.weekStart} to ${input.weekEnd}

POSTS THIS WEEK:
${posts}

NOTABLE WEATHER (only these days are notable):
${weather}

ACTIVE NOTES (maturing this week):
${notes}

KNOWN CYCLE DATES:
${dates}`;
}

function extractJson(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

const FINDING_TYPES: readonly FindingType[] = ['clanger', 'weather_opportunity', 'note_integration', 'date_conflict'];
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Validate + code-filter one raw finding, or null to drop it. */
function normalizeFinding(raw: unknown, input: AuditInput): Finding | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = r.type as FindingType;
  if (!FINDING_TYPES.includes(type)) return null;
  const trigger = str(r.trigger);
  if (!trigger) return null;
  const severity: FindingSeverity = r.severity === 'fix' ? 'fix' : 'suggest';
  const postId = str(r.postId);
  const noteId = str(r.noteId);

  // Code guards: never let the model action findings the inputs don't support.
  if (type === 'weather_opportunity' && !input.flags.any) return null;
  if (type === 'note_integration') {
    if (!noteId || !input.notes.some((n) => n.id === noteId)) return null;
    if (!postId || !input.posts.some((p) => p.id === postId)) return null;
  }
  if ((type === 'clanger' || type === 'date_conflict') && (!postId || !input.posts.some((p) => p.id === postId))) return null;
  const toDate = typeof r.toDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.toDate) ? r.toDate : null;
  // A date_conflict with no corrected date can't be actioned as a move.
  if (type === 'date_conflict' && !toDate) return null;

  return { type, severity, postId, noteId, toDate, trigger };
}

/** Pass 1: the Haiku audit. Never throws — malformed output yields no findings. */
export async function runAudit(input: AuditInput, model: ModelClient): Promise<Finding[]> {
  let raw = '';
  try {
    const res = await model.complete({
      model: 'haiku',
      system: WEEKLY_AUDIT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildAuditUserMessage(input) }],
      maxTokens: 1200,
      temperature: 0,
    });
    raw = res.content;
  } catch { return []; }

  const parsed = extractJson(raw) as { findings?: unknown } | null;
  const findings = parsed && Array.isArray(parsed.findings) ? parsed.findings : [];
  return findings.map((f) => normalizeFinding(f, input)).filter((f): f is Finding => f !== null);
}

// ── Caps (code-enforced) ──────────────────────────────────────────────────────
export interface Caps { maxWeather: number; maxRewrite: number }

export interface CapResult { actioned: Finding[]; skipped: Finding[] }

/** A rewrite is generated for a clanger or a note_integration on an existing post. */
const isRewrite = (f: Finding) => f.type === 'clanger' || f.type === 'note_integration';

/**
 * Cap actioned findings: at most maxWeather weather_opportunity and maxRewrite
 * rewrites. date_conflict moves are deterministic and uncapped. Order preserved;
 * findings beyond a cap are reported (skipped), not actioned.
 */
export function applyCaps(findings: Finding[], caps: Caps): CapResult {
  const actioned: Finding[] = [];
  const skipped: Finding[] = [];
  let weather = 0;
  let rewrite = 0;
  for (const f of findings) {
    if (f.type === 'weather_opportunity') {
      if (weather < caps.maxWeather) { weather++; actioned.push(f); } else skipped.push(f);
    } else if (isRewrite(f)) {
      if (rewrite < caps.maxRewrite) { rewrite++; actioned.push(f); } else skipped.push(f);
    } else {
      actioned.push(f); // date_conflict
    }
  }
  return { actioned, skipped };
}

// ── Session summary message ───────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtWeekOf(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  return `w/c ${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** The quiet-week message when nothing was actioned. */
export function quietMessage(weekStart: string): string {
  return `Checked ${fmtWeekOf(weekStart)}: forecast unremarkable, no maturing notes, no conflicts. No changes proposed.`;
}

/** The change-summary message: a lead-in plus each proposal's summary (which
 *  carries its trigger). */
export function changeMessage(weekStart: string, proposalSummaries: string[], skippedCount: number): string {
  const head = `Weekly check for ${fmtWeekOf(weekStart)}: ${proposalSummaries.length} change${proposalSummaries.length === 1 ? '' : 's'} proposed for review:`;
  const body = proposalSummaries.map((s) => `• ${s}`).join('\n');
  const tail = skippedCount > 0 ? `\n(${skippedCount} further finding${skippedCount === 1 ? '' : 's'} noted but not actioned this week.)` : '';
  return `${head}\n${body}${tail}`;
}
