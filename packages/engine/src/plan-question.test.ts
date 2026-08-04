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
