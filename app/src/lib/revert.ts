/**
 * revert.ts — the pure revert decision, free of any DB import so it is unit-testable.
 *
 * The baseline is source_meta.original, captured once at generation/backfill and
 * NEVER overwritten by an edit or a regen. So revert always returns to the generated
 * starting point, regardless of how many times the post was reshaped in between.
 */
import type { PostFormat } from './types';

const FORMATS = new Set<PostFormat>(['reel', 'carousel', 'single', 'email']);

export interface RevertableRow {
  status:        string;
  caption:       string | null;
  format:        string;
  pillar:        string | null;
  scheduledDate: string;
  position:      number;
  sourceMeta:    unknown;
}

export type RevertDecision =
  | { action: 'remove' }                                   // an added draft → remove it
  | { action: 'clear' }                                    // no baseline → just clear the edited flag
  | { action: 'restore'; values: { caption: string; format: string; pillar: string; scheduledDate: string; position: number; status: 'planned' } };

interface OriginalSnapshot {
  caption?: string; format?: string; pillar?: string; scheduledDate?: string; position?: number;
}

export function resolveRevert(row: RevertableRow): RevertDecision {
  if (row.status === 'new') return { action: 'remove' };

  const orig = (row.sourceMeta as { original?: OriginalSnapshot } | null)?.original;
  if (!orig) return { action: 'clear' };

  return {
    action: 'restore',
    values: {
      caption:       orig.caption ?? row.caption ?? '',
      format:        orig.format && FORMATS.has(orig.format as PostFormat) ? orig.format : row.format,
      pillar:        orig.pillar ?? row.pillar ?? '',
      scheduledDate: orig.scheduledDate ?? row.scheduledDate,
      position:      typeof orig.position === 'number' ? orig.position : row.position,
      status:        'planned',
    },
  };
}
