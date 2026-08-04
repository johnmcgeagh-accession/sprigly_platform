/**
 * refusals.ts — a refused write, said in the client's language.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────
 *
 * The surface is optimistic-first for reversible mutations: the card moves, the format flips, the
 * task ticks, and the server confirms behind it. That trade is only honest if a refusal is
 * *visible* and *specific* — a change that silently reverts is worse than one that never
 * happened, because the client has already stopped looking.
 *
 * `call()` said "Something went wrong. Please try again." for every one of them. That sentence
 * cannot be acted on: it does not distinguish "that date has passed" (do something different)
 * from a network blip (do the same thing again). The routes have always returned a code; nothing
 * read it.
 *
 * The draft routes already return a written `message` and it is used as-is — those sentences live
 * next to the guards that produce them (`draft-mutations.ts`), which is the right home. This map
 * is for the committed routes, which return a code and no prose.
 *
 * Pure. No React, no fetch.
 */

/** Codes the post routes and `gatePostEdit` return. Anything unlisted falls through. */
const BY_CODE: Record<string, string> = {
  read_only:      'That date has already passed, so this one can’t change any more.',
  not_found:      'We couldn’t find that post — it may have been removed.',
  no_cycle:       'We couldn’t find that month.',
  no_session:     'Your link has expired. Open the most recent email from us to carry on.',
  bad_date:       'That date doesn’t look right.',
  bad_json:       'Something in that didn’t reach us properly. Try again?',
  bad_request:    'Something in that didn’t reach us properly. Try again?',
  format_unsupported: 'That format doesn’t take one of those.',
  caption_required:   'Write the caption first — the hook and the script are built around it.',
  // The draft fence, said in the client's language. "planned post" and "draft", never the
  // internal word for a slot (spec §7) — these strings render on screen.
  draft_row:          'That’s a planned post in a month you haven’t approved yet. Open that month to change it.',
  draft_month:        'That month is still a draft you haven’t approved. Approve it first, then posts can be added and moved there.',
};

/** When the server said nothing we can use. Never blames the client for our own outage. */
const GENERIC = 'That didn’t save. Nothing has changed — try again?';
const OFFLINE = 'We couldn’t reach the server. Nothing has changed — check your connection and try again.';

/**
 * What to tell the client when a write came back refused.
 *
 * @param body   the parsed response body, if there was one
 * @param status the HTTP status, if there was one. `0` means the request never landed.
 *
 * Every sentence says what happened to their change, because after an optimistic update the
 * question they are actually asking is "is my edit still there?" — and the answer is no.
 */
export function refusalMessage(body: unknown, status = 0): string {
  if (status === 0) return OFFLINE;
  const rec = (body ?? {}) as Record<string, unknown>;
  // A written message from the route wins: it was authored beside the guard that produced it.
  if (typeof rec['message'] === 'string' && rec['message'].trim()) return rec['message'];
  const code = typeof rec['error'] === 'string' ? rec['error'] : '';
  return BY_CODE[code] ?? GENERIC;
}
