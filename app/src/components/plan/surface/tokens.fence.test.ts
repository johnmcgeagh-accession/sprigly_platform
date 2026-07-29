/**
 * tokens.fence.test.ts — the surface is brand-agnostic by construction.
 *
 * The brand is deliberately in motion: the repo's assets are coral, the plan surface is to
 * become mint, and the theme that decides is created by an operator in admin rather than by
 * this build. That only works if no component can name a colour. A grep for hex literals over
 * these files must return nothing at all — so it is a test, run on every commit, rather than a
 * grep somebody remembers to run.
 *
 * It scans SOURCE rather than rendered markup on purpose. The failure it guards against is a
 * hex typed into a className or an inline style, which is a fact about the file; a rendered
 * check would only catch it on whatever code path the test happened to exercise.
 *
 * Two other fences ride along, for the same reason and in the same shape:
 *   - no `text-slate-*` / `bg-slate-*`. Tailwind's native slate scale is a literal grey OUTSIDE
 *     the theme. The old surface used it for every piece of text, which meant a theme could
 *     repaint the accent and nothing else.
 *   - nothing wider than the narrowest supported viewport can hold (carry-in X7).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIR = join(process.cwd(), 'src', 'components', 'plan', 'surface');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Strip block and line comments. A hex NAMED in prose is documentation, not a paint. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const FILES = sources(DIR);

describe('the tokens-only invariant', () => {
  it('scans a real set of files (a fence over nothing is not a fence)', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(8);
  });

  it('no component names a colour', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const hits = code(readFileSync(f, 'utf8')).match(/#[0-9a-fA-F]{3,8}\b/g);
      if (hits) offenders.push(`${relative(process.cwd(), f)}: ${hits.join(', ')}`);
    }
    expect(offenders, `hex literals belong in the theme, never in a component:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no component reaches for Tailwind’s native slate scale', () => {
    // slate-700 is #334155 — the same value as `chrome`, and permanently so. Using it means a
    // theme can change the accent and leave every word on the surface the old colour.
    const offenders: string[] = [];
    for (const f of FILES) {
      const hits = code(readFileSync(f, 'utf8')).match(/\b(?:text|bg|border|ring|fill|stroke)-slate-\d{2,3}\b/g);
      if (hits) offenders.push(`${relative(process.cwd(), f)}: ${hits.join(', ')}`);
    }
    expect(offenders, `use the theme's chrome / muted / line, not Tailwind slate:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('every colour it does name resolves through a --t-* variable', () => {
    // Where a raw `rgb(var(...))` is unavoidable (a box-shadow, which Tailwind cannot tokenise
    // with an alpha), the variable must still be a theme one and must carry a fallback.
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const m of code(readFileSync(f, 'utf8')).matchAll(/var\((--[a-z0-9-]+)/g)) {
        if (!m[1]!.startsWith('--t-')) offenders.push(`${relative(process.cwd(), f)}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('narrow viewports (carry-in X7)', () => {
  // 320px is the narrowest phone still in circulation; 20px gutters leave 280px of content.
  // jsdom has no layout engine, so the geometry cannot be measured — what CAN be asserted is
  // that nothing declares a width the viewport could not hold, which is where an overflow
  // would come from if there were one.
  const CONTENT_AT_320 = 280;

  it('nothing declares a fixed width wider than 320px can hold', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const m of code(readFileSync(f, 'utf8')).matchAll(/\b(?:min-)?w-\[(\d+)px\]/g)) {
        if (Number(m[1]) > CONTENT_AT_320) offenders.push(`${relative(process.cwd(), f)}: ${m[0]}`);
      }
    }
    expect(offenders, `wider than a 320px viewport's content box:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('nothing is held open by a min-width in a flex row', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const m of code(readFileSync(f, 'utf8')).matchAll(/\bmin-w-\[(\d+)px\]/g)) {
        if (Number(m[1]) > 60) offenders.push(`${relative(process.cwd(), f)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('text never dissolves into its background — no alpha on an ink utility unless disabled', () => {
    // The defect this pins is real and this suite could not see it: jsdom computes no colour, so
    // `text-muted/40` on the month grid's padding days rendered at 1.8:1 and shipped through
    // every unit test in Session A. The first e2e axe run found it in one pass.
    //
    // The rule: an ink utility carries no alpha. `disabled:` is the one exception — WCAG exempts
    // a disabled control, and greying one out is how a platform says "not now".
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = code(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/(?:^|[\s'"`])((?:[a-z-]+:)*)(?:placeholder:)?text-(?:chrome|chrome-deep|muted|white|danger|coral-\d+)\/\d+/g)) {
        if ((m[1] ?? '').includes('disabled:')) continue;
        offenders.push(`${relative(process.cwd(), f)}: ${m[0].trim()}`);
      }
    }
    expect(offenders, `ink at partial alpha — check it against 4.5:1 or drop the alpha:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('whitespace-nowrap is used only where the content is short and bounded', () => {
    // A nowrap on a long string is the classic source of horizontal overflow. The month title
    // is the one legitimate case (three words, flanked by its own arrows), plus meta labels
    // that are a time or a count.
    // Each entry is a justification, not an exemption:
    //   PlanShell   — the month title. Three words, flanked by its own 40px arrows, and the
    //                 longest real value ('September 2026') measured inside 390px in round 3.
    //   TaskList    — the due chip: 'Late' or 'Oct 3'. flex-none beside a truncating body, so
    //                 it is the one thing on the row that must NOT wrap. (It lived in
    //                 TasksPanel until the row was shared with the detail sheet — round 6, P9.)
    const allowed = new Set(['PlanShell.tsx', 'TaskList.tsx']);
    const offenders: string[] = [];
    for (const f of FILES) {
      const name = f.split('/').pop()!;
      if (allowed.has(name)) continue;
      if (/\bwhitespace-nowrap\b/.test(code(readFileSync(f, 'utf8')))) offenders.push(relative(process.cwd(), f));
    }
    expect(offenders, `nowrap outside the allowed list — check it cannot overflow at 320px:\n${offenders.join('\n')}`).toEqual([]);
  });
});
