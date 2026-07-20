/**
 * surface-state.test.ts — the one surface decision.
 *
 * This replaces reasoning about four stacked early returns in page.tsx. The mixed-state
 * rule in particular now has a direct home: it was previously only assertable through a
 * hand-restated predicate in the view test.
 */
import { describe, it, expect } from 'vitest';
import { resolveSurfaceKind, mayHaveDraftSurface, type SurfaceFacts } from '@/lib/surface-state';

const facts = (over: Partial<SurfaceFacts> = {}): SurfaceFacts => ({
  hasSession: true, committedPostCount: 0, draftBeatCount: 0, planRedesign: false, ...over,
});

describe('resolveSurfaceKind', () => {
  it('no session → gated, whatever else is true', () => {
    expect(resolveSurfaceKind(facts({ hasSession: false, committedPostCount: 12, draftBeatCount: 5, planRedesign: true })))
      .toBe('gated');
  });

  it('drafts and no committed posts → the draft surface', () => {
    expect(resolveSurfaceKind(facts({ draftBeatCount: 10 }))).toBe('draft');
  });

  it('MIXED STATE: committed posts win, always — drafts stay invisible', () => {
    // Build A's known interim state: a whole-plan regen leaves drafts behind. They must
    // not take the surface from a plan the client already has.
    expect(resolveSurfaceKind(facts({ committedPostCount: 12, draftBeatCount: 10 }))).toBe('committed-legacy');
    expect(resolveSurfaceKind(facts({ committedPostCount: 12, draftBeatCount: 10, planRedesign: true }))).toBe('committed-redesign');
  });

  it('a single committed post is enough to win the surface', () => {
    expect(resolveSurfaceKind(facts({ committedPostCount: 1, draftBeatCount: 30 }))).toBe('committed-legacy');
  });

  it('an empty cycle falls through to the committed shell, which renders its own empty state', () => {
    expect(resolveSurfaceKind(facts())).toBe('committed-legacy');
    expect(resolveSurfaceKind(facts({ planRedesign: true }))).toBe('committed-redesign');
  });

  it('the redesign flag never overrides the draft surface', () => {
    // The flag chooses between committed shells. It is not a third axis on top of drafts.
    expect(resolveSurfaceKind(facts({ draftBeatCount: 10, planRedesign: true }))).toBe('draft');
  });

  it('is a pure function of its facts — same input, same answer', () => {
    const f = facts({ committedPostCount: 3, draftBeatCount: 2, planRedesign: true });
    expect(resolveSurfaceKind(f)).toBe(resolveSurfaceKind(f));
  });
});

describe('mayHaveDraftSurface — keeps the page lazy', () => {
  it('is false when committed posts exist, so a committed load pays no draft query', () => {
    expect(mayHaveDraftSurface({ hasSession: true, committedPostCount: 12 })).toBe(false);
  });

  it('is false without a session', () => {
    expect(mayHaveDraftSurface({ hasSession: false, committedPostCount: 0 })).toBe(false);
  });

  it('is true only when a draft could actually win the surface', () => {
    expect(mayHaveDraftSurface({ hasSession: true, committedPostCount: 0 })).toBe(true);
  });

  it('never skips a query the resolver would have needed', () => {
    // The invariant tying the two together: if resolveSurfaceKind CAN return 'draft' for
    // some draftBeatCount, mayHaveDraftSurface must have said yes.
    for (const committedPostCount of [0, 1, 5]) {
      const couldBeDraft = resolveSurfaceKind(facts({ committedPostCount, draftBeatCount: 1 })) === 'draft';
      if (couldBeDraft) expect(mayHaveDraftSurface({ hasSession: true, committedPostCount })).toBe(true);
    }
  });
});
