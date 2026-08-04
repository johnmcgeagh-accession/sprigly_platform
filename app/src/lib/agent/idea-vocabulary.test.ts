/**
 * idea-vocabulary.test.ts — the parser has words for "idea" (F6).
 *
 * "idea" appeared ZERO times in TASK_PARSER_SYSTEM_PROMPT. The only idea-shaped action, add_note,
 * was described as "remember a fact/instruction for the plan", and "theme" was an explicit
 * add_post trigger. So "I have a idea for October the TV Halloween theme…" had nothing to land
 * on, and came back as a clarify inventing a refusal about October — in direct violation of the
 * prompt's own rule against exactly that.
 *
 * These are STATIC assertions on the prompt text, which is what a prompt regression looks like:
 * the behaviour itself is model-dependent and was verified live (see the commit message), but a
 * later edit that quietly removes the vocabulary would pass every behavioural fixture in this
 * directory, because they all stub the model.
 */
import { describe, it, expect } from 'vitest';
import { TASK_PARSER_SYSTEM_PROMPT } from './task-parser';

const P = TASK_PARSER_SYSTEM_PROMPT;

describe('the vocabulary exists at all', () => {
  it('says the word', () => {
    expect(P.toLowerCase()).toContain('idea');
  });

  it('routes an idea to add_note, by name', () => {
    expect(P).toMatch(/AN IDEA IS A THING THE CLIENT CAN SAY, AND IT IS AN "add_note"/);
  });

  it('lists the phrasings a client actually uses', () => {
    for (const phrase of ['I have an idea', "here's a thought", 'what if we', 'for the future', 'note this down']) {
      expect(P, phrase).toContain(phrase);
    }
  });

  it('names the verb as the discriminator, not the subject — so "theme" still works both ways', () => {
    expect(P).toMatch(/the verb decides, not the subject/);
    // The add_post trigger it competed with is still there, and still lists a theme.
    expect(P).toMatch(/ANGLE DEFAULT for add_post: a named product, collection, drop, theme or event is a SUFFICIENT instruction/);
  });
});

describe('an idea may name a month with no plan', () => {
  it('tells the parser to set targetMonth regardless of the month list', () => {
    expect(P).toMatch(/SET "targetMonth" to that month.*Do this WHETHER OR NOT the month appears in the client's month list/s);
  });

  it('forbids answering an idea with "that month isn\'t in your plan"', () => {
    expect(P).toMatch(/NEVER answer an idea with "that month isn't in your plan"/);
  });

  it('names the exact sentences that must never be emitted', () => {
    // The two the live transcript produced, verbatim, plus their near neighbours.
    for (const banned of [
      "October isn't in your current plan yet",
      "October isn't in your current plan view",
      'your visible months are',
      'did you mean a different month?',
    ]) {
      expect(P, banned).toContain(banned);
    }
  });
});

describe('the thread is not a source of examples', () => {
  // Established by experiment: with the SAME message and context, a thread of three successes
  // produced add_note 4/4 while a thread of three refusals produced clarify 4/4 — and the
  // refusal wording was lifted almost verbatim from a previous turn's refusal about November.
  it('says a refusal in the thread is a record, never a template', () => {
    expect(P).toMatch(/IF THE CONVERSATION ABOVE CONTAINS REFUSALS, THEY ARE NOT EXAMPLES/);
    expect(P).toMatch(/never re-use a refusal's wording for a new request/);
  });
});

describe('the worked examples', () => {
  const examples = P.split('\nMessage: ').slice(1);

  it('includes an idea naming a month with no cycle, and it resolves to add_note + targetMonth', () => {
    const ex = examples.find((e) => e.startsWith('"I have a idea for October'));
    expect(ex, 'the transcript case is a worked example').toBeTruthy();
    expect(ex!).toContain('"action":"add_note"');
    expect(ex!).toContain('"targetMonth":"2026-10"');
    expect(ex!).not.toContain('"action":"clarify"');
  });

  it('includes an idea with no month at all', () => {
    const ex = examples.find((e) => e.startsWith('"here\'s a thought'));
    expect(ex).toBeTruthy();
    expect(ex!).toContain('"action":"add_note"');
    // The emitted JSON carries no month — the prose above it does say "no targetMonth".
    expect(ex!).not.toContain('"targetMonth":');
  });

  it('includes the SAME subject as an add_post, so the contrast is on the page', () => {
    const ex = examples.find((e) => e.startsWith('"add a reel about the Halloween theme'));
    expect(ex).toBeTruthy();
    expect(ex!).toContain('"action":"add_post"');
    expect(ex!).toContain('"format":"reel"');
  });

  it('includes the compound case — an idea AND a request to place it', () => {
    const ex = examples.find((e) => e.startsWith("\"I've got an idea for October"));
    expect(ex).toBeTruthy();
    expect(ex!).toContain('"action":"add_note"');
    expect(ex!).toContain('"action":"add_post"');
  });

  it('at least two of them are idea examples, as the brief asked', () => {
    const ideaExamples = examples.filter((e) => e.includes('"action":"add_note"'));
    expect(ideaExamples.length).toBeGreaterThanOrEqual(2);
  });
});
