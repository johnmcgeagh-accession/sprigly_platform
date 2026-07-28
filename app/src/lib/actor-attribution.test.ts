/**
 * actor-attribution.test.ts — every write says whose it was (migration 0090).
 *
 * The measurement substrate for the untouched-post rate. September's experiment asks what
 * share of a generated month a client never engages with, and it is unanswerable if any
 * write path leaves `actor` unset — a missing attribution reads as "nobody", which silently
 * moves the rate in the flattering direction.
 *
 * So this file asserts two different kinds of thing:
 *
 *   1. BEHAVIOUR — the ledger writer puts the actor on the row, and the constants say what
 *      they claim to say.
 *   2. COVERAGE — a source-level fence over every enqueueShape call site in app/, in the
 *      spirit of draft-invisibility.test.ts. The failure this guards against is a NEW write
 *      path added later without an actor, which no behavioural test can see because it does
 *      not exist yet. A grep is the only assertion shaped like that problem.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const h = vi.hoisted(() => ({ inserted: [] as Record<string, unknown>[] }));

vi.mock('@sprigly/db', () => ({
  db: { insert: () => ({ values: (v: Record<string, unknown>) => { h.inserted.push(v); return Promise.resolve(); } }) },
  planActivity: new Proxy({}, { get: (_t, k) => String(k) }),
}));

import { recordActivity, USER_ACTOR, OPERATOR_ACTOR } from './activity';

beforeEach(() => { h.inserted.length = 0; });

const exec = { insert: (t: unknown) => ({ values: (v: Record<string, unknown>) => { void t; h.inserted.push(v); return Promise.resolve(); } }) } as never;

describe('the ledger writer carries the actor', () => {
  it('writes actor alongside origin, not instead of it', async () => {
    await recordActivity(exec, { clientId: 'c1', action: 'rescheduled', actor: USER_ACTOR });
    expect(h.inserted[0]).toMatchObject({ origin: 'user', actor: 'client' });
  });

  it('lets the two disagree — an approved proposal is composed by the agent and wanted by the client', async () => {
    await recordActivity(exec, {
      clientId: 'c1', action: 'caption_saved',
      actor: { origin: 'agent', actor: 'client', refProposalId: 'prop-1' },
    });
    expect(h.inserted[0]).toMatchObject({ origin: 'agent', actor: 'client', refProposalId: 'prop-1' });
  });
});

describe('the named actors', () => {
  it('the app’s default write is the CLIENT’s — every route here is behind a magic-link session', () => {
    expect(USER_ACTOR).toEqual({ origin: 'user', actor: 'client' });
  });

  it('an operator write is still origin user, but is not a client touch', () => {
    expect(OPERATOR_ACTOR).toEqual({ origin: 'user', actor: 'operator' });
  });
});

// ── The coverage fence ───────────────────────────────────────────────────────────────
// Walk app/src for enqueueShape call sites and require each to state an actor. A shape job
// is the one write that crosses into the worker, where the session that caused it no longer
// exists — so if the enqueuer does not say, nothing downstream can.

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The `enqueueShape({ … })` argument object at each call site, source text as written. */
function enqueueShapeCalls(source: string): string[] {
  const calls: string[] = [];
  const re = /enqueueShape\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let depth = 0;
    const start = m.index + m[0].length - 1;
    for (let i = start; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') { depth--; if (depth === 0) { calls.push(source.slice(start, i + 1)); break; } }
    }
  }
  return calls;
}

describe('every shape enqueuer in app/ states an actor', () => {
  const files = walk(SRC).filter((f) => f.includes('enqueueShape') || readFileSync(f, 'utf8').includes('enqueueShape('));

  it('finds the call sites at all (a fence over nothing is not a fence)', () => {
    const total = files.flatMap((f) => enqueueShapeCalls(readFileSync(f, 'utf8'))).length;
    expect(total).toBeGreaterThan(0);
  });

  it('none of them omits it', () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // queue.ts DEFINES enqueueShape; it does not call it with a literal.
      if (f.endsWith(join('lib', 'queue.ts'))) continue;
      for (const call of enqueueShapeCalls(src)) {
        if (!/\bactor\b\s*[:,}]/.test(call)) missing.push(`${f.replace(SRC, 'src')}: ${call.replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    }
    expect(missing, `these enqueue a shape job without saying whose it is:\n${missing.join('\n')}`).toEqual([]);
  });
});
