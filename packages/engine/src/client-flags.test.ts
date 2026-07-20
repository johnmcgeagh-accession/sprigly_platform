import { describe, it, expect } from 'vitest';
import { readDraftFlowFlag, DRAFT_FLOW_FLAG } from './client-flags.js';

describe('readDraftFlowFlag — strict, and default OFF', () => {
  it('is on only for the boolean true', () => {
    expect(readDraftFlowFlag({ [DRAFT_FLOW_FLAG]: true })).toBe(true);
  });

  it.each([
    ['missing settings',   null],
    ['undefined settings', undefined],
    ['an empty object',    {}],
    ['false',              { [DRAFT_FLOW_FLAG]: false }],
    ['the STRING "true"',  { [DRAFT_FLOW_FLAG]: 'true' }],
    ['the number 1',       { [DRAFT_FLOW_FLAG]: 1 }],
    ['a different flag',   { plan_redesign: true }],
  ])('is off for %s', (_label, settings) => {
    expect(readDraftFlowFlag(settings as Record<string, unknown> | null | undefined)).toBe(false);
  });

  it('a stray string can never flip a tenant into a flow that emails their client', () => {
    // The whole reason the check is === true rather than truthy.
    expect(readDraftFlowFlag({ [DRAFT_FLOW_FLAG]: 'yes' })).toBe(false);
    expect(readDraftFlowFlag({ [DRAFT_FLOW_FLAG]: 'false' })).toBe(false);
  });
});
