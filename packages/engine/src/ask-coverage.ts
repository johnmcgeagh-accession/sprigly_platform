/**
 * ask-coverage.ts — did the month that generated actually carry the brief's undated asks?
 *
 * `brief-shortfall.ts` asks whether EXTRACTION kept what the client wrote. This asks the next
 * question, one stage later: whether GENERATION used what extraction kept. Its docblock
 * (brief-shortfall.ts:36-38) already named this gap as outside its own range — "Anything
 * dropped that is not a product: an undated content ask… Those are real losses and this module
 * is silent on them." This is that silence answered.
 *
 * The loss it measures, measured: ivy-t's September 2026 brief (prod cycle d71da70e) carried
 * ten content_asks, four of them verbatim opening hooks. All four reached `structured_brief`
 * intact and none reached any of the month's 33 posts. Nothing noticed. The gap was found by
 * hand-reconciling captions against the brief a month later.
 *
 * PURE — no db, no model, no clock. The caller loads the posts and decides what to do with the
 * answer, exactly as the intake route does for `briefProductShortfall`.
 *
 * ── WHY THERE ARE THREE VERDICTS AND NOT TWO ─────────────────────────────────────────────────
 *
 * Asks are not one kind of thing, and a detector that pretends they are would be worse than no
 * detector. Two examples from that same September brief:
 *
 *   "Hook: Do you avoid sorting your wardrobe out?"      (45 chars)
 *   "We don't compete with fast fashion because we don't make fast fashion. We are in our own
 *    lane. Every piece is produced in small batches…"    (493 chars)
 *
 * The first is a line to publish: if those words are absent from every post, the ask was not
 * honoured, full stop. The second is an argument to make in the client's own voice, and it
 * legitimately appears as paraphrase. Reporting it "missing" because no sentence matched would
 * be a false accusation — on this very cycle it landed across four posts.
 *
 * So absence is only conclusive for the first kind. `unmeasured` is not a failure of the module;
 * it is the module declining to guess, and it is the majority verdict by design.
 *
 * ── THE SIGNALS, AND THE NUMBERS BEHIND THEM ─────────────────────────────────────────────────
 *
 * Measured over the September cycle (10 asks, 33 posts, 25,062 caption chars). The column is the
 * longest CONTIGUOUS run of the ask's own words appearing in the month's text:
 *
 *   ask                                       longest run   content words   title echo
 *   not-fast-fashion-brand-values                      31              22            —
 *   navy-edit-customer-reaction                         6               2          yes
 *   named-after-women-brand-story                       3               1          yes
 *   cost-per-wear-education                             6               4            —
 *   what-i-am-most-proud-of-series                      3               2            —
 *   customer-message-hook                               3               2            —
 *   organic-cotton-sensitive-skin-education             0               0            —
 *   wardrobe-avoidance-hook                             0               0            —
 *   shop-your-wardrobe-hook                             0               0            —
 *   reach-for-same-clothes-hook                         0               0            —
 *
 * VERBATIM is the strong positive signal, and the thresholds sit in the wide gap that table
 * shows: 31 words / 22 content words for the argument that genuinely landed, against a best of
 * 6 / 4 for everything that did not. That 6/4 is `cost-per-wear`'s "for a long sleeve t shirt" —
 * the client's PRODUCT vocabulary, not her argument — which is exactly why the bar is 8/5 and
 * not 4/2. A run that clears it is not coincidence; nothing in English produces eight consecutive
 * matching words by accident.
 *
 * TITLE ECHO is the second positive signal and it exists because verbatim prose is not the only
 * way an ask can land. The plan generator names beats after asks it is working from: the ask
 * `navy-edit-customer-reaction` became the post titled "September opener — Navy Edit customer
 * reaction". De-kebabbed, the type IS the title. This catches asks that became their own beat
 * rather than their own sentences, and it degrades safely — no echo is no claim, never a
 * shortfall.
 *
 * QUOTED LINE is the only negative signal, and it is the whole reason the module can say
 * anything definite. An ask whose note OPENS with a quotation marker — "Hook: …" — is a line the
 * client wants used, and the note is that line rather than being about it. So its absence is
 * proof rather than inference, and only such asks can ever be reported `unused`.
 *
 * ── WHY THE `type` SUFFIX IS NOT THE CLASSIFIER ──────────────────────────────────────────────
 *
 * The obvious shortcut is to read the extractor's own labels — `customer-message-hook` ends in
 * `-hook`, so treat it as quotable. It does not survive contact with the data. Across all
 * twenty content_asks persisted on UAT, ZERO use a `-hook` suffix; the labels are `feature`
 * (twice), `teaser`, `brand-story`, `connie-details-post`, `colour-reveal`, `customer-quotes`.
 * The four `-hook` types are one extraction run's phrasing, not a contract — `brief-extract.ts`
 * asks only for "a short kebab-case label", and `arcRoleOf` (brief-schedule.ts:64-66) already
 * records the same conclusion for the same field: "a free-form kebab label the model chooses…
 * an enum would be a contract the extractor was never given."
 *
 * The marker in the NOTE is the reliable signal, because the client writes it. Tested against
 * those same twenty UAT asks it fires zero times — correctly declining the three notes that
 * merely contain the word ("Hook needed.", "…where we did this"), because a request for a hook
 * is not a hook. The `type` is still used, but as a PHRASE for the title echo, where a miss
 * costs nothing.
 *
 * ── WHAT IT CANNOT DO ────────────────────────────────────────────────────────────────────────
 *
 * Stated plainly, in the manner of the module it mirrors:
 *   - It cannot tell a paraphrased ask from an omitted one. That is `unmeasured`, and on a
 *     typical brief most asks land there. `cost-per-wear-education` is the honest hard case:
 *     the client's specifics (24p per wear, "less than a coffee") appear nowhere, yet the module
 *     reports `unmeasured` rather than `unused`, because the note is nine sentences of argument
 *     and it cannot prove which of them a caption was meant to carry.
 *   - It cannot tell whether an ask was used WELL — only whether its words are present.
 *   - It cannot see an ask the extractor never wrote down. That is `briefProductShortfall`'s
 *     range for products, and nobody's range for anything else.
 * A shortfall reported is real; silence is not proof.
 */

/** What the month's generated text says about one ask. */
export type AskVerdict =
  /** Positive evidence found: a long verbatim run, or a beat titled after the ask. */
  | 'used'
  /** A quoted line the client asked for, absent from every post. The only conclusive absence. */
  | 'unused'
  /** Thematic, with nothing positive found. Paraphrase and omission are indistinguishable. */
  | 'unmeasured';

/** One ask, and why it was judged as it was. */
export interface AskCoverageItem {
  /** The ask's `type`, as the extractor labelled it — the caller's handle on it. */
  type:    string;
  product: string | null;
  verdict: AskVerdict;
  /** Longest contiguous run of the ask's own words found in the month's text, in words. */
  longestRun:   number;
  /** How many of those were content words (not stopwords) — what makes a run meaningful. */
  contentWords: number;
  /** True when a post title echoes the de-kebabbed `type`. */
  titleEcho:    boolean;
  /** The quoted line, when the note opens with a marker; null for a thematic ask. */
  quotedLine:   string | null;
}

export interface AskCoverage {
  items:      AskCoverageItem[];
  /** Types with a conclusive absence — THE reportable finding. */
  unused:     string[];
  used:       string[];
  unmeasured: string[];
}

/** No brief, no asks, or nothing to say — the shape callers can rely on. */
export const NO_ASK_COVERAGE: AskCoverage = { items: [], unused: [], used: [], unmeasured: [] };

/**
 * The fields of a generated post this reads.
 *
 * A structural type rather than an import of the row: this package must not depend on the
 * schema to answer a question about text, and the caller already holds the rows.
 *
 * `notes` is deliberately ABSENT. Sprigly Notes are the internal steer that TELLS a caption to
 * carry an ask; finding the ask there would prove it was planned, not that it was delivered. The
 * client reads the caption. Counting the instruction as the outcome is exactly the mistake that
 * let this month look complete.
 */
export interface AskCoveragePost {
  // `| undefined` is explicit because the package sets exactOptionalPropertyTypes: a caller
  // mapping a DB row writes `{ title: row.title ?? undefined }`, and a shape that only allowed
  // the key to be ABSENT would reject the one construction every real caller uses.
  title?:   string | null | undefined;
  caption?: string | null | undefined;
  hook?:    string | null | undefined;
  script?:  string | null | undefined;
  overlay?: string | null | undefined;
}

/** A run this long, carrying this many content words, is evidence rather than coincidence. */
export const VERBATIM_MIN_WORDS   = 8;
export const VERBATIM_MIN_CONTENT = 5;

/** How much of a quoted line must appear before the module stops calling it absent. */
export const QUOTED_MIN_RUN = 4;

/**
 * Note prefixes that introduce a line to publish rather than a description of one.
 *
 * Anchored at the START of the note on purpose. "Hook needed." (a real UAT ask) contains the
 * word and asks for the opposite — for us to write one — so a keyword scan would read a request
 * as a requirement and report it unused forever.
 */
const QUOTE_MARKER = /^\s*(?:hook|opening line|opener|caption|line|copy|quote|text)\s*[:–—-]\s*(.+)$/is;

/**
 * Words carried by every caption in English, which therefore evidence nothing.
 *
 * Small and closed on purpose. This exists to stop "at the end of august" — a real six-word run
 * from `navy-edit-customer-reaction` against this month's text — from reading as delivery of the
 * ask. It is not stemming and not a stoplist for search; it is the divisor that makes a run
 * length mean something.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from',
  'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'we', 'you', 'your', 'our', 'i', 'me',
  'my', 'it', 'its', 'this', 'that', 'these', 'those', 'do', 'does', 'did', 'not', "don't",
  'so', 'if', 'then', 'than', 'there', 'here', 'what', 'who', 'how', 'why', 'when', 'will',
  'can', 'just', 'up', 'out', 'about', 'into', 'over', 'all', 'more', 'some', 'they', 'them',
]);

/**
 * Lowercase, strip punctuation, collapse whitespace.
 *
 * The typographic replacements are load-bearing rather than tidy. A brief is typed in a
 * browser and a caption is written by a model, so the same sentence reaches this function with
 * a curly apostrophe on one side and a straight one on the other; without folding them, "don't"
 * never matches "don't" and the strongest signal in the module silently stops firing.
 */
function normalise(text: string): string {
  const folded = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[…–—]/g, ' ');
  return folded.replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordsOf(text: string): string[] {
  const n = normalise(text);
  return n ? n.split(' ') : [];
}

/** Every contiguous run of `min`..`max` words in the corpus, as a lookup set. */
function runIndex(corpusWords: readonly string[], max: number): Set<string> {
  const set = new Set<string>();
  for (let n = 3; n <= max; n++) {
    for (let i = 0; i + n <= corpusWords.length; i++) set.add(corpusWords.slice(i, i + n).join(' '));
  }
  return set;
}

/** The longest contiguous run of `askWords` that appears in the index. */
function longestSharedRun(askWords: readonly string[], index: Set<string>, max: number): string[] {
  let best: string[] = [];
  for (let i = 0; i < askWords.length; i++) {
    const room = Math.min(max, askWords.length - i);
    for (let n = room; n >= 3; n--) {
      if (index.has(askWords.slice(i, i + n).join(' '))) {
        if (n > best.length) best = askWords.slice(i, i + n);
        break;   // longest at this start position — shorter ones are contained by it
      }
    }
  }
  return best;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Which of the brief's undated asks the generated month carries, and which it demonstrably
 * dropped.
 *
 * Never throws. Like the detector it mirrors, this runs after the month is already written and
 * a measurement that can fail the thing it measures is worse than the gap it reports.
 */
export function briefAskCoverage(
  brief: unknown,
  posts: readonly AskCoveragePost[],
): AskCoverage {
  if (!brief || typeof brief !== 'object') return NO_ASK_COVERAGE;
  const rawAsks = (brief as { content_asks?: unknown }).content_asks;
  if (!Array.isArray(rawAsks) || rawAsks.length === 0) return NO_ASK_COVERAGE;

  const rows = Array.isArray(posts) ? posts : [];

  // Two corpora, because the two signals ask different questions. The verbatim corpus is
  // everything the client will READ — a title included, since an ask can land as a beat name.
  // The title corpus is titles alone, so the echo signal cannot be satisfied by body prose
  // that merely happens to repeat the label.
  const deliveredWords = wordsOf(
    rows.map((p) => [p.title, p.caption, p.hook, p.script, p.overlay].map(str).join(' \n ')).join(' \n '),
  );
  const titleText = rows.map((p) => normalise(str(p.title))).filter(Boolean).join(' | ');

  // One index, reused for every ask. Capped: a run longer than this is already far past the
  // threshold, and indexing to the length of the longest note costs memory for no more answer.
  const MAX_RUN = 40;
  const index = deliveredWords.length > 0 ? runIndex(deliveredWords, MAX_RUN) : new Set<string>();

  const items: AskCoverageItem[] = [];

  for (const raw of rawAsks) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as { type?: unknown; product?: unknown; note?: unknown };
    const type = str(a.type).trim();
    if (!type) continue;
    const product = typeof a.product === 'string' && a.product.trim() ? a.product.trim() : null;
    const note = str(a.note);

    const askWords = wordsOf(note);
    const run = longestSharedRun(askWords, index, MAX_RUN);
    const contentWords = run.filter((w) => !STOPWORDS.has(w)).length;

    const echoPhrase = normalise(type.replace(/-+/g, ' '));
    const titleEcho = echoPhrase.length > 0 && titleText.includes(echoPhrase);

    // A quoted line is the note's OWN first sentence after the marker — the client's words,
    // not the extractor's framing that may follow them ("Use as a hook post.").
    const marked = QUOTE_MARKER.exec(note);
    let quotedLine: string | null = null;
    if (marked?.[1]) {
      const firstSentence = marked[1].split(/(?<=[.?!])\s/)[0] ?? marked[1];
      const trimmed = firstSentence.trim();
      if (wordsOf(trimmed).length >= QUOTED_MIN_RUN) quotedLine = trimmed;
    }

    let verdict: AskVerdict;
    if (quotedLine) {
      // Conclusive both ways: the ask IS this line, so its presence is use and its absence is
      // not. Searched at QUOTED_MIN_RUN rather than in full, so a caption that opens with the
      // hook and then punctuates it differently still counts as having used it.
      const quotedRun = longestSharedRun(wordsOf(quotedLine), index, MAX_RUN);
      verdict = quotedRun.length >= QUOTED_MIN_RUN ? 'used' : 'unused';
    } else if (run.length >= VERBATIM_MIN_WORDS && contentWords >= VERBATIM_MIN_CONTENT) {
      verdict = 'used';
    } else if (titleEcho) {
      verdict = 'used';
    } else {
      verdict = 'unmeasured';
    }

    items.push({ type, product, verdict, longestRun: run.length, contentWords, titleEcho, quotedLine });
  }

  if (items.length === 0) return NO_ASK_COVERAGE;

  return {
    items,
    unused:     items.filter((i) => i.verdict === 'unused').map((i) => i.type),
    used:       items.filter((i) => i.verdict === 'used').map((i) => i.type),
    unmeasured: items.filter((i) => i.verdict === 'unmeasured').map((i) => i.type),
  };
}
