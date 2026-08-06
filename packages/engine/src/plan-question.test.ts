/**
 * plan-question.test.ts — questions are answered, requests are done, and neither becomes an idea.
 *
 * ── The bug this pins ────────────────────────────────────────────────────────────────
 *
 * An operator asked the plan, four ways, which of their own ideas had made it into the month.
 * All four were FILED AS NEW IDEAS. The classifier routed on topic words and datelessness —
 * "ideas", no date, therefore a standing idea for the backlog — and had no concept of a question
 * at all. So a client asking what we did with their input was answered by us recording that they
 * had said it again.
 *
 * The four phrasings below are the operator's, verbatim (3 Aug).
 *
 * ── The gate that matters most ───────────────────────────────────────────────────────
 *
 * Half of every reshape is phrased as a question — "can we move the Friday post?", "could you
 * make the 3rd a carousel?". Routing those to an answerer would be a far worse regression than
 * the bug being fixed: the client would be TOLD ABOUT their month instead of changing it. So the
 * request gate runs before the topic gate and fails closed, and most of this file is about it.
 */
import { describe, it, expect } from 'vitest';
import { parsePlanQuestion } from './intake-classify.js';

describe('the four phrasings the operator tried, verbatim', () => {
  const ASKED = [
    'What ideas of mine are integrated into this month',
    'Which of my ideas made it into September?',
    'Have any of the things I told you been used this month?',
    'Show me the ideas you used in this month’s plan',
  ];

  for (const q of ASKED) {
    it(`"${q}" is a question about the client's own inputs`, () => {
      expect(parsePlanQuestion(q)).toBe('ideas');
    });
  }

  it('none of them is null — the whole point is that four different phrasings all route', () => {
    // The failure was not one unlucky sentence. It was a missing distinction, so the fix has to
    // hold across the ways someone actually asks rather than matching one form.
    expect(ASKED.map(parsePlanQuestion)).toEqual(['ideas', 'ideas', 'ideas', 'ideas']);
  });
});

describe('a request in question form is a REQUEST', () => {
  // The expensive mistake. Every one of these is interrogative and about the plan, and every one
  // must still reach the transforms.
  const REQUESTS = [
    'Can we move the Friday post?',
    'Could you make the 3rd a carousel?',
    'Would you add a reel about the restock on the 12th?',
    'Can you push the launch to next week?',
    'Should we swap the Tuesday and Thursday posts?',
    'Will you delete the post on the 9th?',
    'Can we change the September plan to more product?',
    'How about we add a post on the 20th?',
  ];

  for (const r of REQUESTS) {
    it(`"${r}" is not a question`, () => {
      expect(parsePlanQuestion(r)).toBeNull();
    });
  }
});

describe('statements stay statements — the intake path is untouched', () => {
  const STATEMENTS = [
    'add an idea about winter layering',            // the brief's own fixture
    'We should do more behind-the-scenes',
    'The Wilderness candle relaunches on the 24th',
    'More product this month, less founder',
    'Save the winter fabric piece for next month',
    'make Fridays more personal',
  ];

  for (const s of STATEMENTS) {
    it(`"${s}" is not a question`, () => {
      expect(parsePlanQuestion(s)).toBeNull();
    });
  }

  it('"add an idea…" mentions ideas and is still not a question', () => {
    // Topic words were the whole of the old rule, and this is the sentence that shows why they
    // are not enough in either direction: it is ABOUT ideas and it is an instruction.
    expect(parsePlanQuestion('add an idea about winter layering')).toBeNull();
  });
});

describe('questions about the plan that are not about ideas', () => {
  it('"what’s planned next week" is a plan question — the existing query, unbroken', () => {
    expect(parsePlanQuestion('what’s planned next week')).toBe('plan');
  });

  it('reads the passive "planned" without matching the transitive verb "plan"', () => {
    // `plan` is an action verb ("plan a reel for Friday") and a topic word ("what's planned").
    // Getting this wrong in either direction breaks something a client does every week.
    expect(parsePlanQuestion('what is planned for September?')).toBe('plan');
    expect(parsePlanQuestion('plan a reel for Friday')).toBeNull();
  });

  it('handles the ordinary schedule questions', () => {
    expect(parsePlanQuestion('How many posts are in this month?')).toBe('plan');
    expect(parsePlanQuestion('When is the launch post going out?')).toBe('plan');
    expect(parsePlanQuestion('Is there anything on the 14th?')).toBe('plan');
  });
});

describe('the gates, each on its own', () => {
  it('a question about something else entirely falls through to the model', () => {
    // Not our business, and not our place to intercept it. The model has always handled these
    // and still does — a false negative here costs nothing.
    expect(parsePlanQuestion('What time is it?')).toBeNull();
    expect(parsePlanQuestion('How are you?')).toBeNull();
  });

  it('a bare "?" or empty input is not a question about anything', () => {
    expect(parsePlanQuestion('')).toBeNull();
    expect(parsePlanQuestion('   ')).toBeNull();
    expect(parsePlanQuestion('?')).toBeNull();
  });

  it('an indirect question counts — "tell me what…" is asking, not instructing', () => {
    expect(parsePlanQuestion('Tell me which ideas you used')).toBe('ideas');
    expect(parsePlanQuestion('Show me what’s planned for next week')).toBe('plan');
  });

  it('"tell me about the launch" is answered too — it asks for information, not a change', () => {
    // Written the other way round first, asserting that this fell through because there was no
    // wh-word after "me". That was pinning a limitation, not a rule: someone asking to be told
    // about their launch wants to be told about their launch. Answering is right; filing it as
    // a new idea, which is what used to happen, is the bug.
    expect(parsePlanQuestion('Tell me about the launch on the 24th')).toBe('plan');
  });

  it('but TELLING US something is a statement, and still goes to intake', () => {
    // The mirror image, and the one that must not move: "tell me" asks, "tell us" informs.
    expect(parsePlanQuestion('Telling you now — the candle relaunches on the 24th')).toBeNull();
    expect(parsePlanQuestion('We are launching the candle on the 24th')).toBeNull();
  });

  it('a question mark alone is enough grammar, given a topic and no action verb', () => {
    expect(parsePlanQuestion('anything on the calendar for the 3rd?')).toBe('plan');
  });
});

/**
 * ── THE REGISTER, AND WHY THE VERB LIST COULD NOT HAVE BEEN THE RULE ─────────────────
 *
 * The three gates composed to the opposite of the intent stated at the top of this file. Gate 1
 * is broad, gate 2 is broad, and the request check was a narrow 29-verb ALLOWLIST ANDed in as the
 * only exception — so the default outcome was "question" for every request whose verb was not on
 * the list, and the gate that is documented as failing closed failed OPEN.
 *
 * The verbs came from the eight requests above, all of them STRUCTURAL edits, and inherited their
 * vocabulary. The register they cannot cover is EMPHASIS, which is what the composer's own prompt
 * asks for third ("…what's launching, what's on, what you want more of") and which has no bounded
 * verb set: lean into, focus on, prioritise, feature, highlight, do, have, keep, include. `do` is
 * absent and `redo` is present, so "can we do more reels this month" was ANSWERED five times out
 * of five — the client asking most clearly for a change was the least likely to get one.
 *
 * These cases are the ones six more verbs would have fixed one at a time.
 */
describe('an emphasis asked as a question is a REQUEST, whatever its verb', () => {
  const EMPHASIS_REQUESTS = [
    'can we do more reels this month',                        // `do` absent, `redo` present
    'can we lean into the morning routine more this month',   // the reported interception
    'can we lean into the morning routine more in September',
    'can we lean into the morning routine more',
    'could we focus on the school run stuff this month?',
    'can we prioritise reels in September?',
    'would you feature the morning routine more this month?',
    'can we highlight the founder content this month?',
    'should we have more product posts in September?',
    'can we include more behind-the-scenes this month?',
    'can we keep the Friday reels going this month?',
  ];

  for (const r of EMPHASIS_REQUESTS) {
    it(`"${r}" is not a question`, () => {
      expect(parsePlanQuestion(r)).toBeNull();
    });
  }

  it('not one of them carries a verb from the list — the register is what claims them', () => {
    // If this ever fails it means someone widened ACTION_VERB, and the register stopped being
    // the thing under test here. The list is evidence; it is not allowed to become the rule again.
    const ACTION_VERBS = /\b(move|add|change|swap|switch|push|pull|delete|remove|drop|make|put|shift|reschedule|replace|rewrite|write|create|schedule|cancel|postpone|bring|turn|shorten|lengthen|redo|fix|update|edit)\b/i;
    expect(EMPHASIS_REQUESTS.filter((r) => ACTION_VERBS.test(r))).toEqual([]);
  });
});

describe('the same asks as statements — they were never questions and must not become them', () => {
  // Every one of these routes month_scoped/emphasis or evergreen at the classifier, which is the
  // NEXT piece of work. What matters here is only that this gate keeps its hands off them.
  const STATED = [
    'more reels this month please',
    'less founder stuff',
    'we want more product content',
    'more of the school run stuff please',
    'lean into the morning routine more',
    'I’d like to see more morning routine content',
    'more morning routine content',
  ];

  for (const s of STATED) {
    it(`"${s}" is not a question`, () => {
      expect(parsePlanQuestion(s)).toBeNull();
    });
  }
});

describe('a modal can still be asking — the two escapes', () => {
  // The register would eat these, and they are questions. A modal wrapped round "tell me" or
  // round a wh-complement is politeness, not an instruction.
  it('"tell me" / "show me" / "list" after the modal is an indirect question', () => {
    expect(parsePlanQuestion('can you tell me what’s planned for September?')).toBe('plan');
    expect(parsePlanQuestion('could you show me which ideas you used?')).toBe('ideas');
    expect(parsePlanQuestion('can you list the posts in this month?')).toBe('plan');
  });

  it('a wh-word AFTER the opener is an embedded question', () => {
    expect(parsePlanQuestion('can we see what’s planned for the 14th?')).toBe('plan');
  });

  it('the wh-word must be after the opener, not be the opener', () => {
    // "How about we add a post" opens on a wh-word and is a request. If the escape looked at the
    // whole sentence it would excuse every "how about", which is the commonest way to suggest one.
    expect(parsePlanQuestion('How about we add a post on the 20th?')).toBeNull();
  });

  it('the verb list still catches what the escape would let through', () => {
    // "when" is embedded here, so the register alone would call this a question. It is not — and
    // this is why ACTION_VERB is kept as evidence rather than deleted along with its primacy.
    expect(parsePlanQuestion('Can we move the launch to when the stock lands?')).toBeNull();
  });

  it('an AUXILIARY opener is not the request register — the operator’s third phrasing', () => {
    // is/are/do/does/did/has/have/had invert for a question ABOUT STATE. Putting `have` into the
    // register to catch "have you moved it" would cost this sentence, and this sentence is one
    // of the four that caused the gate to exist at all.
    expect(parsePlanQuestion('Have any of the things I told you been used this month?')).toBe('ideas');
    expect(parsePlanQuestion('Is there anything on the 14th?')).toBe('plan');
    expect(parsePlanQuestion('Did you use my note about the restock?')).toBe('ideas');
  });
});

/**
 * ── THE MODAL OPENS A CLAUSE, NOT ONLY A SENTENCE ────────────────────────────────────
 *
 * Anchoring REQUEST_OPENER at `^` missed the commonest shape a client types: the statement,
 * then the ask. "The Wilderness candle relaunches on the 24th, can we build up to it?" is real
 * client input from another client's brief, and it was claimed by this gate and never reached
 * the classifier — because the modal is the eighth word rather than the first. The scope-eval
 * corpus caught it on its first pass (3930c1e).
 *
 * The register is a property of the clause the modal opens. Where that clause sits is
 * punctuation, not meaning.
 */
describe('a modal after a clause boundary is still the request register', () => {
  const AFTER_A_CLAUSE: Array<[string, string]> = [
    ['comma (the real one)',  'The Wilderness candle relaunches on the 24th, can we build up to it?'],
    ['em dash',               'The Navy Edit drops on the 28th — can we build up to it?'],
    ['spaced hyphen',         'The launch is on the 3rd - could you add a teaser?'],
    ['full stop',             'Karen lands mid-month. Can we lean into the school run more?'],
    ['semicolon',             'One more thing; would you make the 12th a reel?'],
  ];

  for (const [boundary, text] of AFTER_A_CLAUSE) {
    it(`${boundary}: "${text}" is not a question`, () => {
      expect(parsePlanQuestion(text)).toBeNull();
    });
  }

  it('the escapes still apply to a mid-sentence modal', () => {
    // The window the escapes read starts at the END OF THE MATCH, not at `opener[0].length` —
    // slicing by length alone would offset it by whatever preceded the boundary and the escapes
    // would be reading the wrong half of the sentence.
    expect(parsePlanQuestion('The launch is on the 24th, can you tell me what’s planned?')).toBe('plan');
    expect(parsePlanQuestion('September looks busy, can we see what’s planned for the 14th?')).toBe('plan');
  });

  it('a modal with NO boundary before it is not an opener', () => {
    // "Which posts should I look at this week?" — 'should' is mid-sentence and mid-clause, so
    // the register does not claim it and it stays a question.
    expect(parsePlanQuestion('Which posts should I look at this week?')).toBe('plan');
  });

  it('a hyphenated word cannot supply the boundary', () => {
    // `\s-{1,2}\s*` requires whitespace BEFORE the hyphen, so 'behind-the-scenes' and
    // 'co-ordinated' can never open a clause.
    expect(parsePlanQuestion('Is the behind-the-scenes shoot on this month?')).toBe('plan');
    expect(parsePlanQuestion('what’s planned for the co-ordinated Sophie shoot?')).toBe('plan');
  });

  it('gate 1 bounds the blast radius — a STATEMENT with a mid-sentence modal is untouched', () => {
    // This is what makes the widening safe, and it is not a property of the pattern: gate 3 only
    // ever sees sentences that already passed gate 1, so a statement carrying a modal is rejected
    // as non-interrogative long before the register is consulted.
    expect(parsePlanQuestion('The candle relaunches on the 24th, we should build up to it')).toBeNull();
    expect(parsePlanQuestion('Karen lands mid-month. We can talk about the school run')).toBeNull();
  });
});

describe('what the register gets wrong — pinned, not tuned away', () => {
  // A genuine question wearing a modal, with no wh-complement and no "tell me". Both of these
  // were ANSWERED before this commit and now fall through to the model, exactly as they did
  // before the question gate existed at all.
  //
  // This is the direction the gate is documented to fail in: a false negative costs one model
  // call, a false positive stops a client changing their month. It is still a real loss, and it
  // is written down here so that the next person reads it as a known cost rather than finding it.
  it('"Should I be worried about the gap in week 3?" is no longer answered', () => {
    expect(parsePlanQuestion('Should I be worried about the gap in week 3?')).toBeNull();
  });

  it('"Would you say September is full?" is no longer answered', () => {
    expect(parsePlanQuestion('Would you say September is full?')).toBeNull();
  });

  it('and the cost now reaches mid-sentence too', () => {
    // Widening the anchor to a clause boundary widens this cost with it: a genuine question
    // wearing a modal after a comma is claimed as a request and falls to the model. Same family
    // as the two above, one more place to land. Recorded rather than tuned around, because the
    // alternative — narrowing the boundary until this passes — would take the real client input
    // this commit exists for back out with it.
    expect(parsePlanQuestion('September is full, can you confirm?')).toBeNull();
  });
});

/**
 * THE WAY A PHONE TYPES: no apostrophe, no question mark.
 *
 * `\b` after `what` matches "what's" and not "whats" — the apostrophe is a non-word character
 * and supplies the boundary; the `s` is a word character and removes it. So gate 1, the GRAMMAR
 * gate, rejected three questions the operator typed live, with `PLAN_TOPIC` matching "week" in
 * every one of them. It was never the vocabulary.
 *
 * Measured on the 19-question query-eval corpus: 17 claimed as written, 17 with apostrophes
 * stripped, 17 with the question mark stripped, 12 with BOTH gone. Every loss is a contraction,
 * and every loss is silent — the client is told "Saved to your ideas" for something they asked.
 */
describe('an elided apostrophe is still a question', () => {
  const OBSERVED = [
    'whats happening the week after next',
    'whats happening in the last week of august',
    'whats happening in the first week of september',
  ];

  it('claims the three phrasings observed live on the draft surface', () => {
    for (const t of OBSERVED) expect(parsePlanQuestion(t)).toBe('plan');
  });

  it('claims every wh-word that contracts, with or without its apostrophe', () => {
    for (const t of [
      'whats in September', 'what’s in September', "what's in September",
      'whens the next reel', 'wheres the carousel this month',
      'whos in the September posts', 'hows the month looking',
      'whys there nothing on the 4th',
    ]) expect(parsePlanQuestion(t)).toBe('plan');
  });

  it('the corpus phrasings survive losing BOTH marks — the five that used to be filed', () => {
    for (const t of [
      'whats in September', 'whats the balance of the pillars', 'whats the format mix in September',
      'whats on the 18th', 'whats on next week',
    ]) expect(parsePlanQuestion(t)).toBe('plan');
  });

  /**
   * "theres" is the same elision and is deliberately NOT an opener.
   *
   * English does not form a question by fronting "there is" — the interrogative is "IS there
   * anything on the 4th", which the auxiliary branch has always claimed. "Theres nothing on the
   * 4th" is a statement, and admitting it here would claim statements as questions: the one
   * false-positive surface this change is otherwise free of. If it is ever added, this test is
   * the argument it has to beat.
   */
  it('does NOT treat "theres" as interrogative — that is a statement', () => {
    expect(parsePlanQuestion('theres nothing on the 4th')).toBeNull();
    expect(parsePlanQuestion('there’s nothing on the 4th')).toBeNull();
    // The real interrogative form is unaffected, and always was.
    expect(parsePlanQuestion('is there anything on the 4th')).toBe('plan');
  });

  it('does not loosen the auxiliary branch — a bare plural is not an opener', () => {
    // The alternation is six named wh-forms, not an optional `s` across the whole list.
    for (const t of ['cans of paint for the shoot', 'dos and donts for the caption', 'ams and pms for posting']) {
      expect(parsePlanQuestion(t)).toBeNull();
    }
  });

  it('gate 3 still runs first — an elided question asking for a change is still a request', () => {
    expect(parsePlanQuestion('whats the best day to move the 22nd to')).toBeNull();
  });
});

describe('a pre-existing limitation this work did not introduce and does not fix', () => {
  it('"What ideas can we still add this month?" is claimed by ACTION_VERB, not the register', () => {
    // Null before the register landed and null after — `add` is on the 29-verb list, so the
    // list claims a genuine question. Surfaced while measuring the clause-boundary change and
    // recorded here so it is not later mistaken for fallout from it. Fixing it means revisiting
    // the verb list, which is its own decision.
    expect(parsePlanQuestion('What ideas can we still add this month?')).toBeNull();
  });
});
