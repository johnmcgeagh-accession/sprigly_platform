/**
 * generation-recovery.test.ts — the shared facts behind "on its way" (spec gap 7).
 *
 * Three consumers read these: the fan-out enqueues with the instruction, the worker's daily
 * sweep enforces the bound, and admin's failed-posts list renders it. Pinning them here is
 * what stops the three drifting into disagreement about how many goes a post gets.
 */
import { describe, it, expect } from 'vitest';
import { captionInstruction, beatSubject, ungroundedLaunch, ungroundedEmailMerge, sweepAttemptsOf, sweepExhausted, MAX_SWEEP_ATTEMPTS, SWEEP_ATTEMPTS_KEY } from './generation-recovery.js';
import { launchArcSubject } from './draft-transforms.js';

/** ivy-t's September, verbatim — the two sentences the observed failure was written without. */
const MOLLY = 'In September we\'re launching Molly on the 18th September we need a launch post and 2 teasers on the lead up';
const REELS = 'can we do more reels this month';
const meta = (basis: string, reason?: string) => ({ slotType: 'proven', rationaleEvidence: { basis, ...(reason ? { reason } : {}) } });

describe('captionInstruction', () => {
  it('names the slot and the pillar, and asks for nothing else', () => {
    expect(captionInstruction('Wilderness candle relaunch — Launch', 'Home & Space')).toBe(
      'Write the caption for this post. It is the "Wilderness candle relaunch — Launch" slot in this month\'s plan, under the Home & Space pillar. Keep it to that subject.',
    );
  });

  it('drops the pillar clause rather than naming an empty pillar', () => {
    expect(captionInstruction('A small moment', '')).toBe(
      'Write the caption for this post. It is the "A small moment" slot in this month\'s plan. Keep it to that subject.',
    );
  });

  it('is unchanged when the beat carries no subject — the 19 observed beats of a month', () => {
    expect(captionInstruction('How Ivy began', 'Origin', null)).toBe(captionInstruction('How Ivy began', 'Origin'));
  });

  it('carries the client\'s own sentence, framed as background rather than as a brief', () => {
    const out = captionInstruction('Molly — Launch', 'Product', MOLLY);
    // The slot brief is intact and still first: the subject ADDS to it, never replaces it.
    expect(out.startsWith('Write the caption for this post. It is the "Molly — Launch" slot')).toBe(true);
    expect(out).toContain(`"${MOLLY}"`);
    // The three load-bearing clauses. Reworded freely; deleted, this is the Karen bug again.
    expect(out).toContain('That is the SUBJECT');
    expect(out).toContain('That arrangement is ALREADY DONE');
    expect(out).toContain('The schedule is never the subject');
  });

  it('does not tell the model to disregard a block shape.ts will wrap in "honour it"', () => {
    // The wrapper is `The client asked for this change: "…". Rewrite the caption to honour it`.
    // A subject block that disclaims itself ("not a brief to carry out") contradicts it, and a
    // contradiction the model must resolve is one it can resolve the wrong way. It reconciles
    // instead: honouring the instruction IS writing this post's share.
    const out = captionInstruction('Molly — Launch', 'Product', MOLLY);
    expect(out).not.toMatch(/not (a brief|an instruction) to (carry out|follow)/i);
    expect(out).toContain("honour it by writing THIS post's share");
  });
});

describe('beatSubject — which reasons are a SUBJECT', () => {
  it('reads the sentence off a beat a client instruction placed', () => {
    expect(beatSubject(meta('client_input', MOLLY))).toBe(MOLLY);
  });

  it('REFUSES emphasis_reweight — a planning preference is not what a post is about', () => {
    // The placement already honoured "more reels". Briefing a caption with it would have
    // told three of September's beats that their subject was the month's format mix.
    expect(beatSubject(meta('emphasis_reweight', REELS))).toBeNull();
  });

  it('refuses every other basis, with or without a reason', () => {
    for (const basis of ['observed', 'template', 'client_added']) {
      expect(beatSubject(meta(basis))).toBeNull();
      expect(beatSubject(meta(basis, 'something'))).toBeNull();
    }
  });

  it('reads malformed jsonb as "no subject" rather than throwing on the fan-out path', () => {
    for (const bad of [null, undefined, 'string', 42, {}, { rationaleEvidence: null }, { rationaleEvidence: 'x' }]) {
      expect(beatSubject(bad)).toBeNull();
    }
    expect(beatSubject(meta('client_input', '   '))).toBeNull();
  });

  it('collapses the whitespace a typed brief arrives with', () => {
    expect(beatSubject(meta('client_input', '  launching   Molly\n\non the 18th '))).toBe('launching Molly on the 18th');
  });
});

describe('ungroundedLaunch — the decline, and the four reasons not to', () => {
  // ivy-t's real catalogue, in the shape the check gets it: EVERY family name, brand
  // collisions included. "ivy" is in here on purpose — see loadProductNames.
  const CAT = new Set(['anna', 'claire', 'elle', 'hannah', 'heather', 'ivy', 'jane', 'jen', 'jules', 'lydia', 'maya', 'nicola', 'thia']);
  const launch = (title: string, reason = MOLLY) => ({ title, beatMeta: meta('client_input', reason) });

  it('declines a launch arc whose subject is in no catalogue', () => {
    for (const part of ['Tease', 'Launch', 'Follow-up']) {
      expect(ungroundedLaunch(launch(`Molly — ${part}`), CAT)).toBe('Molly');
    }
  });

  it('lets a launch naming a catalogue family through', () => {
    expect(ungroundedLaunch(launch('Heather — Launch'), CAT)).toBeNull();
    expect(ungroundedLaunch(launch('Heather restock — Launch'), CAT)).toBeNull();
  });

  it('lets the BRAND\'s own family through — the exclusion that would have broken this', () => {
    // `indexCatalogue` drops brand tokens from `names` so validateText cannot read the brand as
    // a product. Reusing that list here would call ivy-t's own "Ivy" an unknown product.
    expect(ungroundedLaunch(launch('Ivy — Launch'), CAT)).toBeNull();
  });

  it('never declines a beat that is not a launch arc, whatever it names', () => {
    // September's back-to-school beat: uncatalogued subject, client_input, NOT an arc. Naming a
    // product is not its purpose and it carries the client's own words, so it writes.
    expect(ungroundedLaunch(launch('One thing going on in September is the back to school…'), CAT)).toBeNull();
    expect(ungroundedLaunch(launch('Molly'), CAT)).toBeNull();
    expect(ungroundedLaunch(launch('Weekend Style Guide'), CAT)).toBeNull();
  });

  it('never declines an assembler-placed beat — its product came FROM the catalogue', () => {
    for (const basis of ['observed', 'template', 'emphasis_reweight', 'client_added']) {
      expect(ungroundedLaunch({ title: 'Molly — Launch', beatMeta: meta(basis, 'x') }, CAT)).toBeNull();
    }
  });

  it('declines nothing when there is no catalogue — absence is not evidence of absence', () => {
    expect(ungroundedLaunch(launch('Molly — Launch'), new Set())).toBeNull();
  });

  it('is unmoved by case and punctuation around the name', () => {
    expect(ungroundedLaunch(launch('HEATHER — Launch'), CAT)).toBeNull();
    expect(ungroundedLaunch(launch('The Heather, restyled — Launch'), CAT)).toBeNull();
    // A name that merely CONTAINS a family name as a substring is not that family.
    expect(ungroundedLaunch(launch('Janet — Launch'), CAT)).toBe('Janet');
  });
});

describe('ungroundedEmailMerge — the month is not called ready without qualification', () => {
  it('renders both fields blank when nothing is waiting, so the email is v1 verbatim', () => {
    for (const n of [0, -1]) {
      expect(ungroundedEmailMerge(n)).toEqual({ waitingClause: '', waitingNote: '' });
    }
  });

  it('qualifies the sentence rather than adding a claim after it', () => {
    // The clause sits INSIDE "…is ready{{waitingClause}}." so the assertion is never made bare.
    // It carries no full stop: the template keeps that, or a blank render ends mid-sentence.
    const { waitingClause } = ungroundedEmailMerge(3);
    expect(waitingClause).toBe(', with 3 posts waiting on you');
    expect(waitingClause.endsWith('.')).toBe(false);
    expect(waitingClause.startsWith(',')).toBe(true);
  });

  it('has a singular form for every part of it', () => {
    const one = ungroundedEmailMerge(1);
    expect(one.waitingClause).toBe(', with 1 post waiting on you');
    expect(one.waitingNote).toContain("It's a launch.");
    expect(one.waitingNote).toContain('left it blank');
    expect(one.waitingNote).not.toContain('open one and');   // there is only one
    expect(ungroundedEmailMerge(3).waitingNote).toContain("They're launches.");
    expect(ungroundedEmailMerge(3).waitingNote).toContain('left them blank');
  });

  it('carries "rather than guess" over from the card, and never says anything failed', () => {
    for (const n of [1, 3]) {
      const { waitingNote } = ungroundedEmailMerge(n);
      expect(waitingNote).toContain('rather than guess');
      // "yet" is deliberately absent: it implies the system expects to find out on its own,
      // when the client is the only one who can say.
      expect(waitingNote).not.toMatch(/don't know yet/);
      expect(waitingNote.toLowerCase()).not.toMatch(/fail|error|couldn|problem|sorry/);
      // Own paragraph: the leading and trailing newlines are what collapse to v1's exact
      // spacing when the field is blank.
      expect(waitingNote.startsWith('\n')).toBe(true);
      expect(waitingNote.endsWith('\n')).toBe(true);
    }
  });

  it('uses digits, the convention the other Sprigly emails already use', () => {
    // {{daysToCutoff}} days, in the nudge and last-call bodies.
    expect(ungroundedEmailMerge(3).waitingClause).toContain('3 posts');
    expect(ungroundedEmailMerge(12).waitingClause).toContain('12 posts');
  });
});

describe('launchArcSubject', () => {
  it('reads the subject back off the title its transform wrote', () => {
    expect(launchArcSubject('Molly — Tease')).toBe('Molly');
    expect(launchArcSubject('Molly launch — Follow-up')).toBe('Molly launch');
  });

  it('is null for anything that is not an arc beat', () => {
    for (const t of ['Molly', 'How Ivy began', 'WSG: easy mornings start with Thia', '', null, undefined, ' — Launch']) {
      expect(launchArcSubject(t)).toBeNull();
    }
  });
});

describe('the sweep bound', () => {
  it('is two passes', () => {
    expect(MAX_SWEEP_ATTEMPTS).toBe(2);
  });

  it('counts up to the bound, then reports exhausted', () => {
    expect(sweepExhausted({ [SWEEP_ATTEMPTS_KEY]: 0 })).toBe(false);
    expect(sweepExhausted({ [SWEEP_ATTEMPTS_KEY]: 1 })).toBe(false);
    expect(sweepExhausted({ [SWEEP_ATTEMPTS_KEY]: 2 })).toBe(true);
    // Above the bound is still exhausted — a stale higher count must not read as "go again".
    expect(sweepExhausted({ [SWEEP_ATTEMPTS_KEY]: 7 })).toBe(true);
  });
});

describe('reading a count out of unvalidated jsonb', () => {
  it('treats absent, null and non-object as never swept', () => {
    expect(sweepAttemptsOf(undefined)).toBe(0);
    expect(sweepAttemptsOf(null)).toBe(0);
    expect(sweepAttemptsOf('2')).toBe(0);
    expect(sweepAttemptsOf({})).toBe(0);
  });

  it('treats a malformed or negative value as never swept, never as exhausted', () => {
    // The direction matters: a garbage value must cost the post a retry it could have had,
    // not deny it one it is owed.
    expect(sweepAttemptsOf({ [SWEEP_ATTEMPTS_KEY]: 'two' })).toBe(0);
    expect(sweepAttemptsOf({ [SWEEP_ATTEMPTS_KEY]: NaN })).toBe(0);
    expect(sweepAttemptsOf({ [SWEEP_ATTEMPTS_KEY]: -3 })).toBe(0);
    expect(sweepExhausted({ [SWEEP_ATTEMPTS_KEY]: 'lots' })).toBe(false);
  });

  it('truncates rather than rounding, so 1.9 passes is one pass', () => {
    expect(sweepAttemptsOf({ [SWEEP_ATTEMPTS_KEY]: 1.9 })).toBe(1);
  });
});
