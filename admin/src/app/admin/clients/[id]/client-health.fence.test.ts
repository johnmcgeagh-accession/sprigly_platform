/**
 * client-health.fence.test.ts — the adoption panel cannot quietly start lying.
 *
 * The AUDIT that produced this: a sweep of every percentage rendered anywhere in admin/ and app/
 * (`grep` for a `%` in a JSX text position) returned exactly the surfaces this feature adds, and
 * nothing else. So there is no pre-existing offender to fix — the defect class arrives WITH this
 * build, and the detector's job is to stop it spreading rather than to clean up after it.
 *
 * The one failure that matters is a number where the honest answer is "we don't know". Two of the
 * three ways to cause it are already impossible:
 *
 *   - reading `adoption` off an unmeasured month is a TYPE error. `MonthHealth` is a discriminated
 *     union and the unmeasured members simply have no such field, so the compiler refuses. That
 *     was not theoretical: writing the trend chart against `pct === null` rather than
 *     `state === 'measured'` failed `tsc` on exactly this, which is the design working.
 *   - a percentage without its denominator is structurally prevented in the panel, where every
 *     one goes through `Ratio` or `Divergence` and both render the count beside it.
 *
 * What the compiler CANNOT see is the third: somebody adds a fourth state to `MonthHealth`, both
 * surfaces fall through their `else` branch, and the new state renders as whatever the fallback
 * happens to be. That is what this file checks, by reading the states out of the engine's source
 * rather than listing them here — a fence that keeps its own copy of the thing it fences is a
 * fence that drifts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE_SRC = join(process.cwd(), '..', 'packages', 'engine', 'src', 'caption-overlap.ts');
const SURFACES = [
  join(process.cwd(), 'src', 'app', 'admin', 'clients', '[id]', 'ClientHealthPanel.tsx'),
  join(process.cwd(), 'src', 'app', 'admin', 'clients', '[id]', 'health', '[channel]', 'page.tsx'),
];

/** The `state:` discriminants declared on the MonthHealth union, read from the source. */
function declaredStates(): string[] {
  const src = readFileSync(ENGINE_SRC, 'utf8');
  const union = src.slice(src.indexOf('export type MonthHealth'), src.indexOf('export interface CaptionPool'));
  return [...new Set([...union.matchAll(/state:\s*'([a-z_]+)'/g)].map((m) => m[1]!))];
}

const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the adoption/divergence fence', () => {
  it('reads the files it claims to fence', () => {
    expect(existsSync(ENGINE_SRC), ENGINE_SRC).toBe(true);
    for (const f of SURFACES) expect(existsSync(f), f).toBe(true);
  });

  it('finds a real union to check against', () => {
    const states = declaredStates();
    expect(states).toContain('measured');
    expect(states.length).toBeGreaterThanOrEqual(4);
  });

  it('every state the type can hold is named somewhere in the surfaces that render it', () => {
    // A state nobody named is a state nobody wrote copy for, and it will render as the fallback —
    // which on both of these surfaces is a number.
    const bodies = SURFACES.map((f) => code(readFileSync(f, 'utf8')));
    const combined = bodies.join('\n');
    const missing = declaredStates().filter((s) => !combined.includes(`'${s}'`));
    expect(
      missing,
      `these MonthHealth states have no copy on any surface — a new one falls through to a number:\n${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('neither surface names a colour by hex', () => {
    // Admin has no theme to follow, but a hex here is still a value nobody can find later.
    for (const f of SURFACES) {
      expect(code(readFileSync(f, 'utf8')).match(/#[0-9a-fA-F]{3,8}\b/g), f).toBeNull();
    }
  });

  it('no surface hard-codes a zero percentage', () => {
    // `0%` as a literal is the exact shape of the lie: a number standing in for an absent answer.
    // Every real zero on these screens is computed from a denominator that is on the screen too.
    for (const f of SURFACES) {
      const hits = code(readFileSync(f, 'utf8')).match(/['"`>\s]0(?:\.0)?%/g);
      expect(hits, `${f}: a literal 0% — is that a measurement or a missing one?`).toBeNull();
    }
  });

  it('the panel renders no percentage except through the two components that carry a count', () => {
    // `Ratio` renders "10 of 36 · 27.8%"; `Divergence` renders "3.9% across 10 matched posts".
    // Any OTHER percentage in this file is one without its sample attached.
    const src = code(readFileSync(SURFACES[0]!, 'utf8'));
    const componentsEnd = src.indexOf('function Unmeasured');
    expect(componentsEnd).toBeGreaterThan(0);
    const belowComponents = src.slice(componentsEnd);
    expect(belowComponents.includes('%}'), 'a percentage outside Ratio/Divergence').toBe(false);
    expect(/\}%/.test(belowComponents), 'a percentage outside Ratio/Divergence').toBe(false);
  });
});
