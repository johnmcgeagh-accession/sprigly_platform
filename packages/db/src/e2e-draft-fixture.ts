/**
 * e2e-draft-fixture.ts — the draft month the Playwright suite reviews.
 *
 * ── Why this is a module and not eight inserts in the seed ───────────────────────────
 *
 * The Generate flow is DESTRUCTIVE: approving flips every beat out of 'draft', and after that
 * the cycle is a committed month. Two projects (desktop and mobile) both need to exercise it,
 * and Playwright runs them against one container with no reseed between them — so something has
 * to put the draft back.
 *
 * That "something" could have hand-patched the statuses. It doesn't, because a restore that
 * lists the fields approval touches is a second description of approval, and it goes stale the
 * first time approval touches a ninth field. Instead the restore DELETES the month and rebuilds
 * it from this file — the same function the seed calls. One definition of what the draft month
 * is; no way for the two to disagree.
 *
 * ── How this stays honest about production rows ──────────────────────────────────────
 *
 * The recurring disease in this project is a fake that has drifted from the thing it stands in
 * for (the prompt-caching split that made every e2e parse see `[object Object]`; the script job
 * that wrote a script without its hook). Three things hold this one in place:
 *
 *   1. `beatMeta` is typed as `BeatMeta`, so a field the assembler adds or renames is a
 *      COMPILE error here rather than a silent divergence.
 *   2. Every evidence variant below is one the assembler actually emits, and the file names
 *      which one — see `draft-assembly.ts` and the `BeatRationaleEvidence` contract.
 *   3. `draft-fixture.parity.test.ts` (app) asserts these rows against the real readers:
 *      `toDraftBeat` maps every one, and `groundingLines` produces the intended line kind for
 *      each. A field that stops being read fails that test.
 *
 * Nothing here is bespoke. If a row could not have come out of the assembler, it does not
 * belong in this file.
 */
import type { BeatMeta } from './schema.js';

/** The client every tenant-A fixture belongs to (seed-e2e.ts). */
export const DRAFT_CLIENT = '11111111-1111-4111-8111-111111111111';

/**
 * The draft cycle. `cycle_month` is the DATA month and the plan it displays is one later
 * (plan.ts, `displayMonth = nextMonth(cycleMonth)`), so 2026-08 displays as SEPTEMBER 2026 —
 * the month the debut run is for, which is the point of testing this one.
 */
export const DRAFT_CYCLE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const DRAFT_CYCLE_MONTH = '2026-08';
export const DRAFT_MONTH_LABEL = 'September 2026';

/**
 * Its own magic-link token, and therefore its own session.
 *
 * Not a `?cycle=` on the committed session: `POST /api/plan/draft/approve` takes the cycle from
 * the SESSION and refuses a body, which is correct — and means a committed session pointed at
 * the draft month by query string would approve the wrong month. The session has to be the
 * draft's. `resolveLandingCycleId` then lands straight on it, because the home cycle holds a
 * reviewable draft.
 */
export const DRAFT_TOKEN = 'e2e2000000000000000000000000000000000000000';

/** The backlog row one beat came from, so Ideas' tap-through resolves to a real beat. */
export const DRAFT_BACKLOG_INPUT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const DRAFT_BACKLOG_TEXT = 'Shoot the provenance story on film, not phone.';
export const DRAFT_BACKLOG_GIVEN_AT = '2026-06-14';

const B = (n: number) => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`;

/** The beat whose sheet quotes her sentence — the id Ideas' tap-through must land on. */
export const DRAFT_BACKLOG_BEAT = B(4);

/**
 * The month, one row per beat.
 *
 * EIGHT, and the number is a decision: enough that the summary has something to summarise and
 * the approval counts are non-trivial arithmetic (8 captions, 5 hooks, 3 scripts — not 8/8/8,
 * which would pass a wrong implementation), few enough that a suite running two projects
 * against it stays quick.
 *
 * The provenance mix is the real one. Each beat below names the assembler path that produces
 * its evidence shape, because a fixture that only exercises one path proves the surface renders
 * one path.
 */
interface DraftBeatSeed {
  id:       string;
  date:     string;
  format:   'reel' | 'carousel' | 'single';
  pillar:   string;
  title:    string;
  beatMeta: BeatMeta;
}

export const DRAFT_BEATS: DraftBeatSeed[] = [
  // 1 · SERIES — the standing commitment. `seriesDue` is the licence to name the series, and
  //     `lastPlanned` is read through the draft fence (a draft proposing it is not evidence it
  //     ran), so a real date here is the "has run before" branch of the grounding line.
  {
    id: B(1), date: '2026-09-05', format: 'carousel', pillar: 'Style',
    title: 'Weekend Style Guide — the September edit',
    beatMeta: {
      slotType: 'proven',
      rationaleEvidence: {
        basis: 'observed',
        seriesDue: { name: 'Weekend Style Guide', dayOfWeek: 'saturday', lastPlanned: '2026-06-27', monthsObserved: 3 },
        formatEngagement: { format: 'carousel', avgEngagement: 84, posts: 12 },
        pillarShare: 0.3,
        cadenceBasis: { postsPerWeek: 2, source: 'observed', months: 3 },
      },
    },
  },

  // 2 · PRODUCT, previously featured — `lastFeatured` set. productCoverageFact's DATE branch:
  //     "<product> — last in a caption on <date> (N captions)".
  {
    id: B(2), date: '2026-09-08', format: 'single', pillar: 'Product',
    title: 'The linen shirt, a year on',
    beatMeta: {
      slotType: 'proven',
      rationaleEvidence: {
        basis: 'observed',
        productCoverage: { product: 'the linen shirt', lastFeatured: '2026-05-12', mentions: 4 },
        pillarShare: 0.45,
        cadenceBasis: { postsPerWeek: 2, source: 'observed', months: 3 },
      },
    },
  },

  // 3 · PRODUCT, NEVER featured — `lastFeatured: null`. The stronger claim, and the one that
  //     must never render as a zero or an epoch: productCoverageFact's NULL branch drops the
  //     sample count entirely ("never appeared in a caption", no parenthesis).
  {
    id: B(3), date: '2026-09-11', format: 'reel', pillar: 'Product',
    title: 'The corduroy overshirt, on a real body',
    beatMeta: {
      slotType: 'proven',
      rationaleEvidence: {
        basis: 'observed',
        productCoverage: { product: 'the corduroy overshirt', lastFeatured: null, mentions: 0 },
        formatEngagement: { format: 'reel', avgEngagement: 121, posts: 9 },
        cadenceBasis: { postsPerWeek: 2, source: 'observed', months: 3 },
      },
      assumptions: ['no launches or restocks are on record for this month'],
    },
  },

  // 4 · BACKLOG — the experiment drawn from plan_inputs. `sourceRef` is the pointer Ideas
  //     traces; `backlogIdea` is the same sentence carried so the sheet can quote it without
  //     fetching the row. Both, because they answer different questions (see the contract).
  {
    id: DRAFT_BACKLOG_BEAT, date: '2026-09-15', format: 'reel', pillar: 'Origin',
    title: 'Where the cloth comes from — on film',
    beatMeta: {
      slotType: 'experiment',
      sourceRef: DRAFT_BACKLOG_INPUT,
      rationaleEvidence: {
        basis: 'client_input',
        backlogIdea: { text: DRAFT_BACKLOG_TEXT, givenAt: DRAFT_BACKLOG_GIVEN_AT },
        candidateRank: { rank: 1, of: 6, origin: 'client', lifecycle: 'candidate' },
        cadenceBasis: { postsPerWeek: 2, source: 'observed', months: 3 },
      },
    },
  },

  // 5 · PILLAR ONLY — no series, no product, no words of hers. The honest thin case: the sheet
  //     shows the pillar share and the cadence and nothing else, because there is nothing else.
  {
    id: B(5), date: '2026-09-18', format: 'single', pillar: 'Origin',
    title: 'Origin',
    beatMeta: {
      slotType: 'proven',
      rationaleEvidence: {
        basis: 'observed',
        pillarShare: 0.25,
        cadenceBasis: { postsPerWeek: 2, source: 'observed', months: 3 },
      },
    },
  },

  // 6 · EXPERIMENT from a COMPETITOR — the other `candidateRank.origin`, and the case with no
  //     backlogIdea at all, which is why `candidateRank` is documented as absent for candidates
  //     from anywhere but plan_inputs and present here.
  {
    id: B(6), date: '2026-09-22', format: 'carousel', pillar: 'Style',
    title: 'Five ways, one coat',
    beatMeta: {
      slotType: 'experiment',
      rationaleEvidence: {
        basis: 'observed',
        candidateRank: { rank: 2, of: 6, origin: 'competitor' },
        formatEngagement: { format: 'carousel', avgEngagement: 84, posts: 12 },
        cadenceBasis: { postsPerWeek: 2, source: 'observed', months: 3 },
      },
      assumptions: ['we have assumed your posting rate stays where it has been'],
    },
  },

  // 7 · FORMAT ENGAGEMENT leading — the measurement path with no product or series behind it.
  {
    id: B(7), date: '2026-09-25', format: 'reel', pillar: 'Style',
    title: 'The one-minute fitting room',
    beatMeta: {
      slotType: 'proven',
      rationaleEvidence: {
        basis: 'observed',
        formatEngagement: { format: 'reel', avgEngagement: 121, posts: 9 },
        pillarShare: 0.3,
        cadenceBasis: { postsPerWeek: 2, source: 'observed', months: 3 },
      },
    },
  },

  // 8 · The month's last, on a Monday — gives the grid a beat in its final week.
  {
    id: B(8), date: '2026-09-29', format: 'single', pillar: 'Product',
    title: 'What we are making next',
    beatMeta: {
      slotType: 'proven',
      rationaleEvidence: {
        basis: 'observed',
        pillarShare: 0.45,
        cadenceBasis: { postsPerWeek: 2, source: 'observed', months: 3 },
      },
    },
  },
];

/**
 * The rows, ready to insert into `content_cycle_posts`.
 *
 * `status: 'draft'` throughout AND no committed row in the cycle — that pair is what makes
 * `resolveSurfaceKind` answer 'draft' (committedPostCount === 0 && draftBeatCount > 0). A
 * single non-draft row here would silently turn the whole fixture into a committed month, and
 * `approveDraftCore` would refuse with `mixed_state`.
 *
 * `sourceMeta.title` is where `toDraftBeat` reads the heading from — the pillar is only its
 * last resort, which beat 5 deliberately exercises by carrying its pillar as its title.
 */
export function draftBeatRows(clientId = DRAFT_CLIENT, cycleId = DRAFT_CYCLE) {
  return DRAFT_BEATS.map((b, i) => ({
    id: b.id,
    clientId,
    cycleId,
    channel: 'instagram',
    scheduledDate: b.date,
    format: b.format,
    pillar: b.pillar,
    caption: '',
    status: 'draft',
    position: i + 1,
    sourceMeta: { title: b.title } as Record<string, unknown>,
    beatMeta: b.beatMeta,
  }));
}

/** The backlog row beat 4 came from. Its `used_in_cycle_id` is the draft's, so Ideas reads it
 *  as "Used in September 2026" — the month, derived through `nextMonth`, not the raw column. */
export function draftBacklogInput(clientId = DRAFT_CLIENT, cycleId = DRAFT_CYCLE) {
  return {
    id: DRAFT_BACKLOG_INPUT,
    clientId,
    type: 'idea',
    content: DRAFT_BACKLOG_TEXT,
    status: 'active',
    source: 'voice',
    lifecycle: 'used',
    usedInCycleId: cycleId,
    createdAt: new Date(`${DRAFT_BACKLOG_GIVEN_AT}T09:00:00Z`),
  };
}

/**
 * What approving this month PRODUCES, which is what the Generate confirm states — 8 captions
 * (one per post), 5 opening hooks (the reels and the carousels), 3 scripts (the reels).
 *
 * Written down here so the e2e asserts a number derived from the fixture rather than one copied
 * off the screen it is testing. Deliberately NOT computed with `approvalCounts`, which is the
 * function under test; `draft-fixture.parity.test.ts` checks the two agree.
 */
export const DRAFT_APPROVAL_COUNTS = { captions: 8, hooks: 5, scripts: 3 } as const;

/**
 * What `startPhase2` enqueues SYNCHRONOUSLY, which is a different number and not a smaller
 * promise.
 *
 * The approve response reports queue depth, not outcomes. A caption goes out for every post (8).
 * A STANDALONE hook job goes out for carousels only (2): a reel's hook is written by its
 * combined hook+script job, which the worker enqueues once that reel's caption lands, so a reel
 * given a standalone hook as well would have its hook written twice, incoherently (phase2.ts).
 * Scripts are likewise not in this response at all — they follow the captions.
 *
 * The e2e asserts `hooksQueued` against THIS, and the confirm's "5 opening hooks" against the
 * constant above. Both are true; they count different things, and conflating them is how a
 * correct fan-out gets "fixed" into a broken one.
 */
export const DRAFT_PHASE2_QUEUED = { captions: 8, standaloneHookJobs: 2 } as const;

/**
 * Every `plan_inputs` id the SEED creates for this tenant.
 *
 * It exists so the restore can say "and nothing else": a reshape the applier cannot place files
 * the sentence to the backlog, by design and correctly — and the draft e2e types two of those on
 * purpose. Without a known set, each run left two more ideas behind, the Ideas rail climbed run
 * over run (8 → 24 over a morning), and the committed suite's Ideas assertions were quietly
 * depending on how many times anyone had run the draft one.
 *
 * Fixed ids rather than a timestamp cutoff: "these are the rows the seed made" is a fact, and a
 * cutoff is a guess that goes wrong the first time a seed runs slowly.
 */
export const SEED_PLAN_INPUT_IDS = [
  DRAFT_BACKLOG_INPUT,
  '33333333-3333-4333-8333-333333333331',   // 'used'      — the committed month's idea
  '33333333-3333-4333-8333-333333333332',   // 'next_cycle'
  '33333333-3333-4333-8333-333333333333',   // 'declined'
  '33333333-3333-4333-8333-333333333334',   // 'candidate'
  '33333333-3333-4333-8333-333333333341',   // the three voice-sourced notes
  '33333333-3333-4333-8333-333333333342',
  '33333333-3333-4333-8333-333333333343',
] as const;
