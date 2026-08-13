/**
 * brief-shortfall.ts — did the extraction come back with everything the brief named?
 *
 * `extractStructuredBrief` can return a COMPLETE, gate-passing StructuredBrief that silently
 * omits part of the client's notes. Measured on ivy-t's November brief (cycle 5ea00045, 1,162
 * chars of freeNotes read against 41 existing beats): five of five runs finished on end_turn at
 * ~1,500–1,700 output tokens — well under the cap — and each returned a valid brief naming
 * Hannah and Connie while dropping the three products the tail of the notes launched.
 *
 * Nothing downstream notices. `briefArcDatesFor` (brief-schedule.ts) matches schedule entries by
 * product NAME, so a dropped product finds no entry, answers `{}`, and the caller falls back to
 * LAUNCH_ARC's [-5, 0, +3]. The client briefs a launch date and gets a generic arc, and the only
 * difference between that and a correct extraction is three rows nobody counted.
 *
 * This module counts them. It is PURE — no db, no model, no clock. The caller reads the
 * catalogue and decides what to do with the answer, exactly as it already does for
 * `durableContext` and `currentPlan`.
 *
 * ── WHY THE CATALOGUE IS THE KEY, AND WHAT THAT COSTS ────────────────────────────────────────
 *
 * To know something is MISSING you need an independent list of what should be there, and the
 * brief is unstructured text — the extractor is the only thing that reads it. The one list we
 * hold without asking a model is the client's own product catalogue, and it happens to be the
 * right list: `briefArcDatesFor` matches on product name, so a name is exactly the unit whose
 * loss has a consequence.
 *
 * What that buys, measured over all seven real UAT briefs carrying both notes and a persisted
 * brief: fifteen catalogue names mentioned across them, one shortfall reported — Maggie on
 * 5ea00045, the known defect — and no false positives.
 *
 * What it does NOT catch, stated plainly because a detector trusted past its range is worse than
 * none:
 *   - A product not in the catalogue. A genuinely new name the client is launching for the first
 *     time is invisible here until the catalogue refresh picks it up. (The X and Y of the
 *     original report are this case, which is why they are absent from the numbers above.)
 *   - Anything dropped that is not a product: an undated content ask, a conflict, a beat whose
 *     entry names no product. Those are real losses and this module is silent on them.
 *   - A product that survives into `products[]` but loses its `schedule` entry. The name is still
 *     present, so this reads as covered — while `briefArcDatesFor`, which only walks `schedule`,
 *     still answers `{}`.
 * It is a floor, not a measurement. A shortfall reported is real; silence is not proof.
 */

/** A catalogue name mentioned in the brief but absent from everything the extraction returned. */
export interface BriefShortfall {
  /** Catalogue names the brief text mentions. */
  named:   string[];
  /** Of those, the ones the extraction returned nowhere. */
  missing: string[];
}

/** No catalogue, no brief text, or nothing to say — the shape callers can rely on. */
export const NO_SHORTFALL: BriefShortfall = { named: [], missing: [] };

/**
 * Whole-word, case-SENSITIVE match for `name` in `text`.
 *
 * Case-sensitive is the load-bearing choice. Half this catalogue is ordinary English worn as a
 * first name — Joy, Rose, Iris, Jane, Sam, Bea — and a case-insensitive scan reads "spread joy
 * this Christmas" as a product launch, then reports it missing when the extractor rightly
 * ignores it. Product names are capitalised wherever a client writes them; lower-case `joy` is
 * the word, not the garment.
 *
 * The boundary is `\p{L}` rather than `\b` so that "Maggie's" and "Maggie," both match while
 * "Maggies" does not — an apostrophe is not a letter, so the name still ends at a boundary.
 */
function mentions(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, 'u').test(text);
}

/**
 * Which catalogue products the brief names, and which of those the extraction lost.
 *
 * `brief` is searched WHOLE — products, schedule, content_asks, focus and conflicts alike — and
 * deliberately so. A name that reached any of them was read; this is asking whether the
 * extractor saw the product at all, not whether it filed it in the right array. Scoping the
 * search to `schedule` would report a shortfall every time the model correctly logged a passing
 * mention as an undated ask.
 *
 * Never throws. It runs on the save path after the brief has already been persisted, and a
 * detector that can fail the request it is measuring is worse than the gap it reports.
 */
export function briefProductShortfall(
  freeNotes: string | null | undefined,
  brief:     unknown,
  catalogue: readonly string[],
): BriefShortfall {
  const notes = (freeNotes ?? '').trim();
  if (!notes || !brief || typeof brief !== 'object') return NO_SHORTFALL;

  const names = catalogue.filter((n) => typeof n === 'string' && n.trim().length > 0);
  if (names.length === 0) return NO_SHORTFALL;

  // One serialisation, searched once per name — the brief is small and this runs per save.
  let haystack: string;
  try { haystack = JSON.stringify(brief); } catch { return NO_SHORTFALL; }

  const named = names.filter((n) => mentions(notes, n));
  return { named, missing: named.filter((n) => !mentions(haystack, n)) };
}
