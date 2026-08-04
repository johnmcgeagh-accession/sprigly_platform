/**
 * plan-answers.ts — the answers to questions about the plan, COMPUTED.
 *
 * ── Why these are not model calls ────────────────────────────────────────────────────
 *
 * A client asking "which of my ideas made it into this month" is asking for a fact we already
 * hold. The Ideas view derives it from `lifecycle`, the month summary counts it with
 * `fromClient`, and both are exact. Handing the same question to a model would produce a fourth
 * account of it, in prose, capable of being wrong in ways the other three cannot — and the one
 * thing worse than not answering a client's question is answering it with an invented number.
 *
 * So the answer is derived from the same rows the surface renders. If the Ideas view says an
 * idea was used in September, this says so too, because it is the same read.
 *
 * ── The register ─────────────────────────────────────────────────────────────────────
 *
 * These are the agent's turns, so they are sentences, not tables. They name what became of
 * things and stop; they do not editorialise, and a nothing-to-report answer says that plainly
 * rather than padding. Absence is a value here as everywhere else on this surface.
 */
import { shortDate } from '@sprigly/engine';
import type { IdeaView } from '@/lib/ideas';
import type { DraftBeatView } from '@/lib/types';

/** One answer, as the thread's lines. Empty means the caller should say nothing at all. */
export type AnswerLines = string[];

const list = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? '')
  : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * "Which of my ideas are in this month?"
 *
 * `cycleId` scopes it to the month on screen — the question says "this month", and an answer
 * listing everything ever used would be answering a different one. `beatTitleFor` resolves the
 * beat an idea became, because "your idea about filming on film became *Where the cloth comes
 * from*" is the answer and "one idea was used" is a statistic.
 */
export function answerIdeasQuestion(params: {
  ideas: readonly IdeaView[];
  cycleId: string;
  monthLabel: string;
}): AnswerLines {
  const { ideas, cycleId, monthLabel } = params;
  const used = ideas.filter((i) => i.state === 'used' && i.usedInCycleId === cycleId);

  if (used.length === 0) {
    // Two different nothings, and they are not interchangeable. A client who has never told us
    // anything needs to know that saying things is how it works; a client who has told us
    // plenty and seen none of it used this month is owed the second sentence, not the first.
    const waiting = ideas.filter((i) => i.state === 'waiting' || i.state === 'deferred');
    if (ideas.length === 0) {
      return [`You haven’t sent us anything yet — tell me what you want and I’ll keep it here.`];
    }
    return waiting.length > 0
      ? [
          `None of your ideas went into ${monthLabel}.`,
          `${waiting.length === 1 ? 'One is' : `${waiting.length} are`} still waiting — say the word and I’ll work ${waiting.length === 1 ? 'it' : 'them'} in.`,
        ]
      : [`None of your ideas went into ${monthLabel}.`];
  }

  const head = used.length === 1
    ? `One of your ideas is in ${monthLabel}:`
    : `${used.length} of your ideas are in ${monthLabel}:`;

  // Her sentence, then what it became. Quoted, because these are her words and this surface
  // does not paraphrase them anywhere else either.
  const rows = used.map((i) => (i.postTitle
    ? `· “${i.content}” — became ${i.postTitle}`
    : `· “${i.content}”`));

  const rest = ideas.filter((i) => i.state === 'waiting' || i.state === 'deferred').length;
  return rest > 0
    ? [head, ...rows, `${rest === 1 ? 'One other is' : `${rest} others are`} still waiting.`]
    : [head, ...rows];
}

/**
 * "What's planned?", "is there anything on the 14th?" — answered from the month's own beats.
 *
 * A draft month has no captions and no knowledge bank behind it: its entire content IS the
 * beats. So the answer is the beats, read back — dates and titles, in order. Narrating them
 * through a model could only add words that are not facts.
 *
 * `dates` narrows to the days the question named, when it named any. Nothing to narrow by is
 * the whole month, which is the right reading of a bare "what's planned".
 */
export function answerPlanQuestion(params: {
  beats: readonly DraftBeatView[];
  monthLabel: string;
  dates?: readonly string[] | undefined;
}): AnswerLines {
  const { beats, monthLabel } = params;
  const scoped = params.dates?.length
    ? beats.filter((b) => params.dates!.includes(b.date))
    : beats;

  if (scoped.length === 0) {
    return params.dates?.length
      ? [`Nothing is planned for ${list(params.dates.map(dayLabel))}.`]
      : [`Nothing is planned for ${monthLabel} yet.`];
  }

  const head = params.dates?.length
    ? `${scoped.length === 1 ? 'One post' : `${scoped.length} posts`} on ${list(params.dates.map(dayLabel))}:`
    : `${scoped.length === 1 ? 'One post' : `${scoped.length} posts`} across ${monthLabel}:`;

  return [head, ...scoped.map((b) => `· ${dayLabel(b.date)} — ${b.title} (${b.format})`)];
}

/**
 * '2026-09-14' → 'Mon 14 Sep', borrowed from `draft-diff` rather than written again.
 *
 * These lines sit in the same thread as the reshape receipts ("Moved: …, Sat 5 Sep → Sat 12
 * Sep"), so a second date format would put two ways of writing a date in one conversation. The
 * first draft of this file had its own `toLocaleDateString`, which rendered "Sept" where every
 * receipt beside it said "Sep".
 */
const dayLabel = shortDate;

/**
 * The dates a question named, resolved against the plan month.
 *
 * Deliberately small: bare ordinals ("the 14th") and nothing else. "Next week" is a real
 * question and a real trap — it depends on today, not on the month on screen, and getting it
 * wrong is the exact bug X1a was raised for — so it is NOT resolved here. An unresolved date
 * phrase simply widens the answer to the whole month, which is honest: the client sees
 * everything and can find the day themselves.
 */
export function datesNamedIn(text: string, planMonth: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi)) {
    const day = Number(m[1]);
    if (day >= 1 && day <= 31) out.push(`${planMonth}-${String(day).padStart(2, '0')}`);
  }
  return [...new Set(out)];
}
