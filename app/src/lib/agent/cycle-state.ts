/**
 * agent/cycle-state.ts — structured reads of the client's cycles for the task
 * parser (cycle months + this-week digest) and the query answerer. Client-scoped.
 */
import { and, eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { loadDraftBeats, loadPlanPosts } from '../plan';
import { isEditableDate } from '../edit-scope';
import type { DraftBeatView, PlanPost } from '../types';
import { fmtDate, parseISO, postTitle } from './selectors';
import { weekLines, weekWindows } from './weeks';
import { daysInMonth, factLines, monthFacts, PLAN_FACTS_HEADING } from './plan-facts';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export function monthLabel(yyyymm: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(yyyymm);
  if (!m) return yyyymm;
  return `${MONTH_NAMES[Number(m[2]) - 1] ?? yyyymm} ${m[1]}`;
}

/**
 * 'YYYY-MM' → that month's first and last day, as the relevance window (F5).
 *
 * The upper bound is computed from the month's own calendar rather than written as a literal:
 * a `${month}-31` bound is an INVALID DATE for September, April, June, November and February,
 * and Postgres rejects it against a `date` column rather than clamping — the same trap
 * `intake-signals.ts:firstOfMonthAfter` documents having already been caught by once.
 *
 * Returns nulls for anything that is not a month, so a malformed value files an undated note
 * rather than a note with half a window.
 *
 * Lives here rather than in `turn.ts` because BOTH paths that file a durable input need it and
 * neither may import the other: `turn.ts` is the agent entry point and `draft-apply.ts` is the
 * intake one, and the two API routes import both. A second implementation next to the second
 * caller is exactly how the two paths would start disagreeing about what October means.
 */
export function monthWindow(month?: string | null): { from: string | null; to: string | null } {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return { from: null, to: null };
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();   // day 0 of the NEXT month
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/** Month name → 1-based number, by first three letters. 'sept' and 'september' both slice to 'sep'. */
const MONTH_ABBREV = MONTH_NAMES.map((n) => n.slice(0, 3).toLowerCase());

/** Every month name and the abbreviations clients actually type. `\b` on both ends is what stops
 *  'mar' matching inside 'marketing' and 'sep' inside 'separate'. */
const MONTH_WORDS = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\b/gi;

/** A preposition immediately before "may" makes it the month ("an idea for may"); without one it
 *  is the modal verb ("we may want more BTS"), which is far commoner in client prose. */
const BEFORE_A_MONTH = /\b(?:in|for|during|by|until|through|of)\s+$/i;

/** "the June heatwave", "the August drop" — a month after "the" is describing the SUBJECT, not
 *  naming a window. See `monthNamedIn`. A following year ("the June 2027 drop") is exempt: a
 *  client who states the year is stating a date. */
const ATTRIBUTIVE = /\bthe\s+$/i;

/**
 * The month a client's own words name, as 'YYYY-MM' — or null if they named none, or more
 * than one.
 *
 * DETERMINISTIC on purpose, and worth saying why rather than reaching for the model that is
 * already on this path: month names are a closed set of twelve, the text is prose the client
 * typed, and the year is arithmetic. A second Bedrock round trip would add latency and cost
 * and a new failure mode to a step whose whole job is to write a row.
 *
 * The year resolves FORWARD FROM THE ANCHOR MONTH — pass today's month, not the plan month.
 * A client saying "August" on 4 August means this August; anchoring on the plan month
 * (September) would file them into next year. Naming the anchor month or any month after it
 * lands inside the next twelve, and no phrasing can name a past month — correct for a backlog,
 * where an idea is always for something still to come.
 *
 * Two DIFFERENT months named → null. "Move the October launch into November" states a
 * relationship between months, not a window to file under, and half a guess is worse than
 * the undated row we already write.
 *
 * ── Every ambiguity resolves to "no window" ──────────────────────────────────────────
 * The same asymmetry `intake-classify.ts` opens with, for the same reason. A month we FAIL to
 * read files the row exactly as it files today: undated, permanently live, visible in the
 * backlog — the status quo, and no worse. A month we read WRONGLY files a live idea into a
 * window it does not belong to, where the durable readers will skip it until that window opens.
 * Those costs are not symmetric, so the reading is deliberately conservative and every doubtful
 * case returns null.
 *
 * The rule that costs the most recall is `ATTRIBUTIVE`, and it is here because of a real row:
 * "a throwback post using the video of Sally fitting the pre-production long sleeve Ivy tee
 * during the June heatwave". June is what the video SHOWS. Without the guard that idea is filed
 * into next June and disappears for ten months. It also declines "the October plan", which is a
 * genuine miss — and a row that stays undated is the right price for not doing that.
 */
export function monthNamedIn(text: string, anchorMonth: string): string | null {
  const a = /^(\d{4})-(\d{2})$/.exec(anchorMonth);
  if (!a) return null;
  const anchorYear = Number(a[1]), anchorNum = Number(a[2]);

  /**
   * Two sets, because the two guards below reject for different reasons and only one of them
   * means "this is not a reference to a month at all".
   *
   * `mentioned` is every month the text refers to, however it refers to it. `qualified` is the
   * subset that reads as a WINDOW. The ambiguity test has to run on `mentioned`: in "move the
   * October launch into November" the attributive guard correctly declines October, and scoring
   * that on `qualified` alone would leave November standing unopposed and file the row into a
   * month the sentence was moving things OUT of.
   */
  const mentioned = new Set<number>(), qualified = new Set<number>();
  for (const m of text.matchAll(MONTH_WORDS)) {
    const word = m[1]!;
    const idx = MONTH_ABBREV.indexOf(word.slice(0, 3).toLowerCase());
    if (idx < 0) continue;
    const before = text.slice(0, m.index);
    // 'May' is the one month name that is also an ordinary English word. A modal verb is not a
    // reference to May at all, so it counts for NEITHER set — otherwise "we may post in October"
    // reads as two months and files nowhere.
    if (idx === 4 && word !== 'May' && !BEFORE_A_MONTH.test(before)) continue;
    mentioned.add(idx + 1);
    // Describing the subject rather than naming a window — unless a year follows. Still a real
    // mention, so it stays in `mentioned` and can still make the sentence ambiguous.
    if (ATTRIBUTIVE.test(before) && !/^\s+\d{4}\b/.test(text.slice(m.index + word.length))) continue;
    qualified.add(idx + 1);
  }
  if (mentioned.size !== 1 || qualified.size !== 1) return null;

  const month = [...qualified][0]!;
  const year = month >= anchorNum ? anchorYear : anchorYear + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export interface CycleRow { id: string; month: string; status: string }

/**
 * ── THE PLAN'S BOUNDARY IS THE CALENDAR, NOT THE LAST POST (G2) ──────────────────────
 *
 * The Earl of East October case: the agent told the client the plan "runs up to the 28th" and
 * refused later dates. There is no such rule anywhere in this codebase — a post may be added
 * on any date from today onwards (`add-policy.ts`), and the cycle plans a whole calendar month.
 *
 * The sentence came from the only evidence the model had. Both context builders below listed
 * the posts and nothing else, so the plan's extent was inferrable ONLY as max(scheduled_date):
 * the last post was the 28th, so the plan ended on the 28th. A gap at the end of a month read
 * as the end of the month.
 *
 * So the window is STATED. One line, computed from the plan month's own calendar, saying where
 * the plan begins and ends and that an empty date inside it is empty rather than absent. It
 * costs a line of prompt and closes the whole class: the same reasoning would have refused the
 * 30th of a month whose last post was the 27th, on any month, for any client.
 *
 * ── IT NAMES EVERY MONTH IN SCOPE, NOT ONE (X1a) ─────────────────────────────────────
 *
 * The agent's context now spans several cycles (`plan-context.ts`). A window line naming one of
 * them would be worse than none: it would state a boundary the digest underneath plainly
 * crosses, and the model would have to choose which to believe. It takes a LIST, and the single
 * month remains the one-element case — every existing caller is unchanged.
 */
export function planWindowLine(planMonths: string | readonly string[] | null | undefined): string | null {
  const months = (typeof planMonths === 'string' ? [planMonths] : planMonths ?? [])
    .filter((m): m is string => typeof m === 'string' && /^\d{4}-\d{2}$/.test(m));
  if (!months.length) return null;
  const spans = months.map((m) => `${m}-01 to ${m}-${String(daysInMonth(m)).padStart(2, '0')} (${monthLabel(m)})`);
  const covers = months.length === 1
    ? `THIS PLAN COVERS ${spans[0]} — the whole month.`
    : `YOU CAN SEE ${months.length} MONTHS OF THIS PLAN, IN FULL: ${spans.join('; ')}. `
      + `A date in ANY of these months is a date you can act on — the month on screen is where the client is looking, not the limit of what you may change.`;
  return `${covers} `
    + `A plan does NOT end at its last post: a date inside these windows with no post on it is an EMPTY date in the plan, `
    + `not a date outside it. Never tell the client the plan "runs up to" the last scheduled post, and never refuse a date `
    + `for being later than one.`;
}

/**
 * The month a cycle PLANS, from the month its data covers.
 *
 * `contentCycles.cycleMonth` is the DATA month; the plan it produces is dated a month later
 * (`plan.ts:250`, `displayMonth = nextMonth(cycleMonth)`). Everything the client sees is the
 * plan month, so everything the agent SAYS has to be too — the prompt used to print the data
 * month beside a digest of the plan month's posts, which is how the agent came to tell a client
 * looking at September that it could "only edit posts in the current September 2026 cycle" and,
 * in the same breath, that its digest started on 1 October.
 */
export function planMonthOf(cycleMonth: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(cycleMonth);
  if (!m) return cycleMonth;
  const y = Number(m[1]);
  const mm = Number(m[2]);
  return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
}

/**
 * The client's months, as the parser reads them. Pure, so the shape can be tested without a db.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT SAY.
 *
 * It does not call any cycle "editable", because a cycle is not the unit of editability — a DATE
 * is. Every one of the client's months is browsable and every future-dated post in them is
 * changeable (`edit-scope.ts`), and the old "[current, editable]" marker taught the parser the
 * opposite: that one month was the only one it could act on. That is the sentence the client got
 * back.
 *
 * It does not hide the past or the far future either. Adjacent months have to be listed or a
 * cross-month intent — "push it into next month" — has nowhere to resolve to.
 *
 * The VIEWED cycle is marked, and it is marked as *the month on screen* rather than as a
 * permission: it tells the parser where the client's attention is, which is what a bare reference
 * like "the 5th" needs, without implying that anything else is off limits.
 *
 * `loadedCycleIds` (X1a) marks the months whose POSTS are in this turn's digest. A month that
 * exists but is not loaded is still a month the client owns and still a valid destination for an
 * add or a move — it simply has no rows to resolve a reference against, and saying which is which
 * is what stops "add it to March" reading as "March does not exist".
 */
export function describeCycles(
  rows: readonly CycleRow[], viewedCycleId: string, loadedCycleIds?: readonly string[],
): string {
  if (!rows.length) return '- (no cycles on record)';
  const loaded = loadedCycleIds ? new Set(loadedCycleIds) : null;
  return [...rows]
    .map((r) => ({ ...r, plan: planMonthOf(r.month) }))
    .sort((a, b) => a.plan.localeCompare(b.plan))
    .map((r) => `- ${monthLabel(r.plan)} (${r.plan})${r.id === viewedCycleId ? ' [the month on screen]' : ''}`
      + `${loaded ? (loaded.has(r.id) ? ' [posts listed below]' : ' [posts not listed below — name a date or a title and I WILL find the post; you can also add and move into this month]') : ''} — ${r.status}`)
    .join('\n');
}

/**
 * The client's cycle rows — the ONE read behind every "which months does this client have?"
 * question. Named and exported because the context builder (`plan-context.ts`) needs the same
 * rows the month list needs, and two queries for one fact is how they come to disagree.
 */
export async function listClientCycles(clientId: string): Promise<CycleRow[]> {
  return db
    .select({ id: contentCycles.id, month: contentCycles.cycleMonth, status: contentCycles.status })
    .from(contentCycles)
    .where(eq(contentCycles.clientId, clientId));
}

/** Formatted list of the client's months for the parser prompt, named by what they plan. */
export async function getClientCycleMonths(clientId: string, viewedCycleId: string): Promise<string> {
  return describeCycles(await listClientCycles(clientId), viewedCycleId);
}

/**
 * The month this cycle PLANS ('YYYY-MM'), or null if the row is missing.
 *
 * It returns the plan month, not the stored `cycle_month`. Every caller wants the month the
 * posts are dated in — the one caller that did not know the difference compared a post's date
 * against the data month and therefore refused every in-month move.
 */
export async function getCycleMonth(clientId: string, cycleId: string): Promise<string | null> {
  const [row] = await db
    .select({ month: contentCycles.cycleMonth })
    .from(contentCycles)
    .where(and(eq(contentCycles.clientId, clientId), eq(contentCycles.id, cycleId)))
    .limit(1);
  return row?.month ? planMonthOf(row.month) : null;
}

/** Resolve a PLAN month ('YYYY-MM') to one of the client's cycle ids, or null if none exists. */
export async function resolveCycleForMonth(clientId: string, planMonth: string): Promise<string | null> {
  const rows = await listClientCycles(clientId);
  return rows.find((r) => planMonthOf(r.month) === planMonth)?.id ?? null;
}

/**
 * Does this cycle belong to this client? The viewed cycle arrives from the CLIENT now, so it is
 * checked rather than trusted — the same rule every other write path on this surface follows.
 */
export async function cycleBelongsToClient(clientId: string, cycleId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: contentCycles.id })
    .from(contentCycles)
    .where(and(eq(contentCycles.clientId, clientId), eq(contentCycles.id, cycleId)))
    .limit(1);
  return !!row;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Posts in the same week as `today`.
 *
 * The Monday anchor is `weeks.ts`'s (F1). It used to be a private `weekStart` here — correct, but
 * a second copy of a definition that also has to appear in two prompts, and the prompts are where
 * it went wrong. One function now, and the words the model reads are printed from it.
 */
export function currentWeekPosts(posts: PlanPost[], today: Date): PlanPost[] {
  const { from, to } = weekWindows(iso(today)).thisWeek;
  return posts.filter((p) => p.date >= from && p.date <= to).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Compact digest of the WHOLE cycle's posts (the viewed plan month), by date, WITH ids — the
 * parser resolves references like "the post from the 1st August" or "the Thursday reel" against
 * this. NOT week-scoped: a move between two in-month dates must see the source post even when it
 * falls outside the current week (the "this week" heritage caused false "no posts" replies).
 *
 * ── EVERY DATE CARRIES ITS YEAR, AND ITS SIDE OF TODAY ───────────────────────────────
 *
 * It used to print `fmtDate` alone — `Fri 14 Aug`, with **no year**. The model was then asked
 * whether that date had passed, from a line that does not say which year it is in, and it
 * answered: *"The post on the 14th of August is in August 2026, which is in the past (today is
 * 30 July 2026)."* A future date, called past, in the same breath as the correct today.
 *
 * Nothing in the prompt had told it otherwise. So two things are stated here rather than left to
 * be derived: the ISO date, which is unambiguous and directly comparable against today; and
 * whether the row is `[past]`, computed with the SAME predicate the write gate uses
 * (`isEditableDate`, edit-scope.ts). The model no longer has to do date arithmetic to answer the
 * one question it was getting wrong — it reads the answer off the line.
 *
 * `today` is optional so the pure digest stays testable without it; omitted, no row is marked
 * (the ISO dates alone are still unambiguous).
 *
 * `planMonth` states the WINDOW this list sits inside — see `planWindowLine`. Without it the
 * only readable boundary is the last row, which is how "the plan runs up to the 28th" happened.
 */
export function cycleDigest(posts: PlanPost[], today?: string, planMonth?: string | null): string {
  const window = planWindowLine(planMonth);
  const head = window ? `${window}\n` : '';
  if (!posts.length) return `${head}(no posts in this plan yet)`;
  return head + [...posts]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => {
      const past = today && !isEditableDate(p.date, today) ? ' | [past — read-only]' : '';
      return `- id=${p.id} | ${p.date} (${fmtDate(p.date)})${past} | ${p.channel}/${p.format} | ${postTitle(p)}`;
    })
    .join('\n');
}

export interface CycleState {
  summary: string;
  /** WRITTEN posts in each window. Committed rows only — a beat is never one of these. */
  thisWeek: PlanPost[];
  nextWeek: PlanPost[];
  /**
   * PLANNED POSTS in each window — the same two weeks, over the draft rows.
   *
   * Second pair rather than folded into the first, for `ContextCycle.beats`' reason: `PlanPost[]`
   * is the shape a caller may resolve a reference against, and a beat has its own write path with
   * its own gate. What the omission below cost was a week LINE that undercounted; widening the
   * type to fix a sentence would have put a beat where a mutation could find it.
   */
  thisWeekBeats: DraftBeatView[];
  nextWeekBeats: DraftBeatView[];
  counts: Record<string, number>;
}

/**
 * Bucket a cycle's live posts into this-week / next-week and tally statuses. `planMonth`
 * states the plan's calendar window in the summary — the query answerer reads ONLY this
 * summary, so without it the plan's end is the last post (G2).
 *
 * ── `beats` IS NOT OPTIONAL DECORATION (F4) ──────────────────────────────────────────
 *
 * This summary is the ENTIRE plan context the query answerer receives. Putting draft beats in
 * the parser's digest and not here would move the lie rather than fix it: the parser would route
 * "what's in September" to a `query`, and the answerer — reading a plan state that still knew
 * nothing about September — would say the month was empty exactly as before. Worse, once the
 * answerer DOES see them, it must see what they are: thirty title-bearing rows presented as
 * posts would have it answering caption questions out of the titles.
 *
 * So the beats arrive labelled, under their own heading, stating the count and the absence of
 * captions — the same sentence the digest states, from the same facts.
 */
export function bucketCycleState(
  posts: PlanPost[], today: Date, planMonth?: string | readonly string[] | null,
  beats: readonly DraftBeatView[] = [],
): CycleState {
  // Both windows from `weeks.ts` — the SAME function that prints them into the prompt below, so
  // the sentence the model reads and the posts it is given can never describe different weeks.
  const { thisWeek: tw, nextWeek: nw } = weekWindows(iso(today));
  // Typed on the DATE alone, so the same predicate buckets a written post and a planned one. It
  // used to take a `PlanPost`, which is how the beats came to be missing from the week below:
  // nothing rejected them, there was simply no second call.
  const inWeek = (w: { from: string; to: string }) => (r: { date: string }) => r.date >= w.from && r.date <= w.to;

  const thisWeek = posts.filter(inWeek(tw));
  const nextWeek = posts.filter(inWeek(nw));
  const thisWeekBeats = beats.filter(inWeek(tw));
  const nextWeekBeats = beats.filter(inWeek(nw));

  /**
   * The status tally, over WRITTEN posts only — and unlike the week lines above, that is a
   * decision rather than an oversight. Stated here because the two sit four lines apart and the
   * next person auditing this function for the same omission should not have to re-derive it.
   *
   * Two reasons, either sufficient. A beat is not the plan: `draft-months.test.ts` pins *"beats
   * do NOT inflate the live-post count"*, and `totalLine` below reads this tally. And every beat
   * carries the status `draft`, which is the internal word spec §7 fences out of anything a
   * client can read — folding them in would print it into the prompt, from where a model would
   * repeat it back. The month's planned count is stated on its own PLAN FACTS line instead.
   */
  const counts: Record<string, number> = {};
  for (const p of posts) counts[p.status] = (counts[p.status] ?? 0) + 1;

  // ── TODAY IS IN THE STATE, AND SO IS EACH ROW'S SIDE OF IT ─────────────────────────
  // This summary is the ENTIRE plan context the query answerer gets (query.ts), and it used to
  // contain no today at all — `today` was consumed here for bucketing and then thrown away. So
  // the one other path that can put free text in front of a client could not tell a past date
  // from a future one, and answered "is that in the past?" from nothing. Both facts are stated
  // now, and `[past]` is computed with the write gate's own predicate rather than re-derived.
  const todayIso = iso(today);
  const line = (p: PlanPost) => {
    const past = isEditableDate(p.date, todayIso) ? '' : ' [past — read-only]';
    return `  - ${p.date} (${fmtDate(p.date)})${past} (${p.format}, ${p.pillar || 'no pillar'}): ${(p.caption || '').slice(0, 80)}`;
  };
  // Full plan-month listing (not week-scoped) so the query answerer sees the whole cycle and can
  // answer any date/week question from the dates + today — never blinkered to "this week".
  const byDate = [...posts].sort((a, b) => a.date.localeCompare(b.date));
  const window = planWindowLine(planMonth);
  /**
   * ── THE WEEK IS STATED, NOT DERIVED (F1) ───────────────────────────────────────────
   *
   * Asked on Friday 31 July, the agent answered about 7–13 August: today + 7 through today + 13,
   * a rolling seven days. The buckets three lines above hold the right answer — Mon 3 to Sun 9 —
   * and this summary is ALL the query answerer reads, so until now that answer was computed and
   * discarded while the model was left to do calendar arithmetic it had no calendar for.
   *
   * `weekLines` prints the two windows; the counts beneath come from the buckets themselves, so
   * the prose and the data cannot disagree. Same treatment as `TODAY IS` and the plan window: the
   * model reads the answer off the line rather than working it out.
   */
  /**
   * ── AND A DRAFT MONTH'S POSTS ARE IN THE WEEK TOO ──────────────────────────────────
   *
   * This line counted WRITTEN posts and nothing else, which is invisible until a week crosses
   * into a draft month. Measured on 26 August: Mon 31 Aug to Sun 6 Sep holds five posts — one
   * written in August and four planned in September — and the state said *"NEXT WEEK holds: 1
   * post"*. The agent then answered *"Next week holds 1 post… The rest of the week is empty"*,
   * quoting the state exactly as it is told to. Same class as the counting bug: not a model that
   * reasoned wrongly, a number that was wrong before it was read.
   *
   * ── COUNTED TOGETHER, THE UNWRITTEN ONES MARKED ────────────────────────────────────
   *
   * A client asking what is on next week means everything on the calendar, so a flat five is the
   * count they want; but four of those five have no copy, and a bare five invites "read me the
   * Wednesday one". So the line states the total, then splits it. It is one sentence in every
   * case and it stays one sentence — the dates were already listed here, and what is added is a
   * clause, not a block.
   *
   * A window with NO planned posts renders exactly the sentence it always did, to the byte. That
   * is what keeps this from being a change to every committed client's prompt.
   */
  const n = (c: number, word: string) => `${c} ${word}${c === 1 ? '' : 's'}`;
  const listDates = (rows: readonly { date: string }[]) =>
    [...rows].sort((a, b) => a.date.localeCompare(b.date)).map((r) => r.date).join(', ');
  const weekCount = (label: string, written: readonly PlanPost[], planned: readonly DraftBeatView[]) => {
    const total = written.length + planned.length;
    if (!total) return `${label}: 0 posts.`;
    if (!planned.length) return `${label}: ${n(total, 'post')} — ${listDates(written)}.`;
    // "planned post", never the internal word — spec §7, and this string is prompt vocabulary,
    // which is the one thing a model reliably repeats back into a reply the client reads.
    if (!written.length) {
      return `${label}: ${n(total, 'planned post')}, not one of them written yet — ${listDates(planned)}.`;
    }
    return `${label}: ${total} in total — ${n(written.length, 'written post')} (${listDates(written)})`
      + ` and ${n(planned.length, 'planned post')}, not yet written (${listDates(planned)}).`;
  };

  /**
   * ── THE MONTHS THIS STATE IS ABOUT ─────────────────────────────────────────────────
   *
   * The caller's months when it named any — which is the whole point: the state's window line,
   * its counted facts and its row blocks then describe the SAME set, and cannot contradict each
   * other the way "YOU CAN SEE 2 MONTHS" over a 78-row three-month list did.
   *
   * Falling back to the months the rows themselves fall in keeps the standalone and fixture
   * callers working, and gives them the facts too rather than a bare list.
   */
  const months = monthsInScope(planMonth, byDate, beats);
  const listed = new Set(months);

  /**
   * ── A DRAFT MONTH IS COUNTED AS WHAT IT HOLDS (F4) ─────────────────────────────────
   *
   * Counting only written posts would print *"0 posts. Every one of the month's 30 dates is
   * EMPTY."* over September's thirty planned ones — reinstating, in the one block the model is
   * told to trust above all others, exactly the lie the draft-month work removed. So a month
   * with beats is counted twice under two headings, and the written-post line for a month with
   * none of them says what it is instead of claiming the month is empty.
   */
  const factsFor = (m: string): string[] => {
    const mBeats = beats.filter((b) => b.date.slice(0, 7) === m);
    const written = monthFacts(m, posts);
    if (!mBeats.length) return factLines(monthLabel(m), written);
    const planned = factLines(`${monthLabel(m)} — PLANNED POSTS, not one of them written`, monthFacts(m, mBeats));
    return written.total > 0
      ? [...factLines(`${monthLabel(m)} — WRITTEN POSTS`, written), ...planned]
      : [
          `${monthLabel(m)} (${m}): 0 WRITTEN posts — this month is a DRAFT, and its content is the planned posts counted next. It is NOT empty.`,
          ...planned,
        ];
  };

  /**
   * Rows under a heading per month, the way `spanDigest` already blocks them for the parser. A
   * bare date-sorted run across three months is what made "count September" a search problem;
   * a heading turns it into reading one block — and the block states its own size, so the two
   * accounts of that month sit six lines apart and can be checked against each other.
   */
  const rowBlocks = months.flatMap((m) => {
    const rows = byDate.filter((p) => p.date.slice(0, 7) === m);
    return [
      `${monthLabel(m)} (${m}) — ${rows.length} written post${rows.length === 1 ? '' : 's'}:`,
      ...(rows.length ? rows.map(line) : ['  (no written posts on any date in this month)']),
    ];
  });

  // Anything dated OUTSIDE the months in scope — a post moved across the boundary on the
  // standalone path. Listed rather than dropped: silently losing a row from the state is how
  // the agent comes to say a post does not exist.
  const strays = byDate.filter((p) => !listed.has(p.date.slice(0, 7)));

  /**
   * THE TOTAL SAYS WHAT IT IS THE TOTAL OF.
   *
   * `Plan has N live posts` was the sentence the model quoted back as a single month's count
   * while N covered three of them. With one month in scope it is unambiguous and unchanged; with
   * several it names the scope and forbids the misreading outright, because the per-month figure
   * it should have used is stated six lines above.
   */
  const statusTail = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none';
  const totalLine = months.length > 1
    ? `ACROSS ALL ${months.length} MONTHS IN VIEW, COMBINED: ${posts.length} live posts (${statusTail}).`
      + ` This is the total for every month together. It is NOT any single month's count and must never be`
      + ` given as one — each month's own count is on its PLAN FACTS line above.`
    : `Plan has ${posts.length} live posts (${statusTail}).`;

  const summary = [
    `TODAY IS ${todayIso}. A date is in the FUTURE if it is later than that, and in the PAST only if it is earlier. Compare the ISO dates.`,
    weekLines(todayIso),
    weekCount('THIS WEEK holds', thisWeek, thisWeekBeats),
    weekCount('NEXT WEEK holds', nextWeek, nextWeekBeats),
    ...(window ? [window] : []),
    ...(months.length ? [PLAN_FACTS_HEADING, ...months.flatMap(factsFor)] : []),
    totalLine,
    ...(months.length ? ['Posts (by date):', ...rowBlocks] : byDate.length ? ['Posts (by date):', ...byDate.map(line)] : ['(no written posts scheduled yet)']),
    ...(strays.length ? ['Posts dated OUTSIDE the months above (still yours, still changeable):', ...strays.map(line)] : []),
    ...beatLines(beats),
  ].join('\n');

  return { summary, thisWeek, nextWeek, thisWeekBeats, nextWeekBeats, counts };
}

/**
 * The months a plan state describes: the caller's, or — when it named none — the ones its own
 * rows fall in. Ascending, deduplicated, malformed values dropped.
 */
function monthsInScope(
  planMonth: string | readonly string[] | null | undefined,
  posts: readonly PlanPost[],
  beats: readonly DraftBeatView[],
): string[] {
  const named = (typeof planMonth === 'string' ? [planMonth] : planMonth ?? [])
    .filter((m): m is string => typeof m === 'string' && /^\d{4}-\d{2}$/.test(m));
  if (named.length) return [...new Set(named)].sort();
  return [...new Set([...posts, ...beats].map((r) => r.date.slice(0, 7)))].sort();
}

/** The draft block of the plan state — the same facts the digest states, in the one string the
 *  query answerer reads. Empty array → no lines at all, so a committed month is unchanged.
 *  "PLANNED POST", never the internal word: spec §7 fences it, and prompt vocabulary is what a
 *  model echoes into a reply the client then reads. */
function beatLines(beats: readonly DraftBeatView[]): string[] {
  if (!beats.length) return [];
  const months = [...new Set(beats.map((b) => b.date.slice(0, 7)))].sort();
  const n = beats.length;
  return [
    `DRAFT MONTH${months.length === 1 ? '' : 'S'} — ${n} PLANNED POST${n === 1 ? '' : 'S'} in ${months.map(monthLabel).join(', ')}. READ THIS BEFORE ANSWERING ABOUT ${months.map(monthLabel).join(' or ')}:`,
    `  ${months.length === 1 ? 'This month is' : 'These months are'} NOT empty — ${months.length === 1 ? 'it holds' : 'they hold'} the planned posts listed below. Each is a proposed SLOT the client has not yet confirmed: it has a date, a format, a pillar and a working title, and NO CAPTION.`,
    `  NO POST IN ${months.map((m) => monthLabel(m).toUpperCase()).join(' OR ')} HAS BEEN WRITTEN. There is no caption text for any of them — not a short one, not a rough one, none.`,
    `  You may answer from a planned post's date, format, pillar and title. You may NOT say what it says, quote it, summarise its caption, or describe its wording or tone — that copy does not exist yet. Say so instead.`,
    'Planned posts, not yet written (by date):',
    ...[...beats]
      .sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position)
      .map((b) => `  - PLANNED ${b.date} (${fmtDate(b.date)}) (${b.format}, ${b.pillar || 'no pillar'}): title “${b.title}” — [no caption written yet]`),
  ];
}

/** Load the session cycle's posts and bucket them relative to `today`. Reads the cycle's PLAN
 *  month too, so the summary can state the window rather than leave it to be inferred (G2). */
export async function readCycleState(clientId: string, cycleId: string, today: Date): Promise<CycleState> {
  const [posts, beats] = await Promise.all([
    loadPlanPosts(clientId, cycleId),
    // The standalone path (no PlanContext) needs the beats too, or a caller that skips the
    // context builder gets the pre-F4 answer for a draft month.
    loadDraftBeats(clientId, cycleId).catch(() => []),
  ]);
  const planMonth = await getCycleMonth(clientId, cycleId).catch(() => null);
  return bucketCycleState(posts, today, planMonth, beats);
}
