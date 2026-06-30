/**
 * types.ts — the app/engine contract. PlanPost is the structured post the app
 * reads and (Phase 2+) edits; ShapeRequest/ShapeResult are the agent seam,
 * designed async from the start so Phase 3 isn't a UI rebuild.
 */

export type PostChannel = 'instagram' | 'email';
export type PostFormat  = 'reel' | 'carousel' | 'single' | 'email';
export type PostStatus  = 'planned' | 'edited' | 'new';

export interface PlanPost {
  id:       string;
  cycleId:  string;
  clientId: string;
  channel:  PostChannel;
  date:     string;            // ISO 'YYYY-MM-DD'
  format:   PostFormat;
  pillar:   string;
  caption:  string;
  status:   PostStatus;
  script?:  string | null;
  overlay?: string | null;
}

// ── Agent seam ────────────────────────────────────────────────────────────────
// Post-level and plan-level shaping both go through applyShape. Structural ops
// resolve synchronously ('applied'); language/regen ops return 'pending' + a
// jobId the client resolves via GET /api/jobs/:jobId. Phase 1 ships neither — but
// the types exist now so later phases bolt on without a rebuild.

export type ShapeScope = 'post' | 'plan';

export interface ShapeRequest {
  scope:        ShapeScope;
  cycleId:      string;
  targetPostId?: string;       // when scope === 'post'
  instruction:  string;
  source:       'web' | 'voice';
}

export type ShapeResult =
  | { mode: 'applied'; summary: string; changedPostIds: string[]; posts: PlanPost[] }
  | { mode: 'pending'; summary: string; jobId: string };

// ── Magic-link claims ─────────────────────────────────────────────────────────
export interface LinkClaims {
  clientId: string;
  cycleId:  string;
  exp:      number;            // expiry, epoch ms
}
