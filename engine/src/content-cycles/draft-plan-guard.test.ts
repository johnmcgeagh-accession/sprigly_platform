/**
 * draft-plan-guard.test.ts — assembly refuses outside the pre-planning window.
 *
 * The rehearsal assembled a draft into a `workbook_built` cycle and produced a surface with no
 * editable controls (docs/reports/ivy-t-rehearsal-failures.md F3). assertCycleAssemblable is
 * the guard: a draft may only be built while the cycle is pre-planning. Pure, so both branches
 * are testable without a database — @sprigly/db is mocked to the one value the guard reads (the
 * real PRE_PLANNING_STATUSES set), which keeps this off the network and off env.
 */
import { describe, it, expect, vi } from 'vitest';

// Mirrors packages/db/src/structured-brief-invalidate.ts — the single source of the pre-planning
// set the guard, the draft mutations and the intake route all share. Mocked here so importing
// draft-plan.ts does not load the db client (which parses DATABASE_URL at import).
vi.mock('@sprigly/db', () => ({
  PRE_PLANNING_STATUSES: new Set(['scheduled', 'requested', 'reply_received', 'awaiting_confirmation', 'intake_confirmed']),
}));

const { assertCycleAssemblable } = await import('./draft-plan.js');

describe('assertCycleAssemblable', () => {
  it('permits every pre-planning status', () => {
    for (const status of ['scheduled', 'requested', 'reply_received', 'awaiting_confirmation', 'intake_confirmed']) {
      expect(() => assertCycleAssemblable(status)).not.toThrow();
    }
  });

  it('refuses a cycle past planning, naming the status and the reset command', () => {
    expect(() => assertCycleAssemblable('workbook_built')).toThrow(/workbook_built/);
    expect(() => assertCycleAssemblable('workbook_built')).toThrow(/cycle-reset/);
    expect(() => assertCycleAssemblable('workbook_built')).toThrow(/pre-planning/);
  });

  it('refuses the other post-planning states too', () => {
    for (const status of ['planning', 'generating', 'scheduled_and_approved', 'failed', 'complete']) {
      expect(() => assertCycleAssemblable(status)).toThrow(/past planning/);
    }
  });
});
