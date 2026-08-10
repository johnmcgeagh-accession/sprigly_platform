/**
 * /p/:token redirect test — WHICH MONTH THE MAGIC LINK LANDS ON.
 *
 * The token is minted for one cycle, but the landing rule (resolveLandingCycleId →
 * resolveDayCycleId) prefers the cycle whose plan month contains TODAY. A touch email always
 * fires in the month BEFORE the one it asks about, so on the ask day those are different
 * cycles — which is how a client asked to plan September was shown August and wrote their
 * September brief into August's post-cutoff proposal queue (prod, 10 Aug 2026).
 *
 * The touch emails now name the cycle (`?intake=1&cycle=<id>`), and this route is the hop that
 * has to carry it: it strips the token from the URL, so anything it does not forward is lost
 * before page.tsx ever sees it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  claims: null as { exp: number } | null,
  cookieCalls: [] as unknown[][],
}));

vi.mock('@/lib/auth', () => ({
  verifyLink: async () => h.claims,
  touchLink:  async () => undefined,
  setSessionCookie: (...a: unknown[]) => { h.cookieCalls.push(a); },
}));

const { GET } = await import('./route');

const call = (url: string) => GET(new Request(url), { params: { token: 'tok' } });
/** The redirect target's path + query, which is the whole contract of this route. */
const target = (res: Response) => {
  const loc = new URL(res.headers.get('location') ?? '');
  return `${loc.pathname}${loc.search}`;
};

beforeEach(() => {
  h.claims = { exp: Math.floor(Date.now() / 1000) + 3600 };
  h.cookieCalls = [];
});

describe('/p/:token — parameter forwarding', () => {
  it('carries the cycle a touch email named, so the client lands on the month they were asked about', async () => {
    const res = await call('https://app.example.com/p/tok?intake=1&cycle=cyc-sep');
    expect(target(res)).toBe('/?intake=1&cycle=cyc-sep');
  });

  it('carries a cycle on its own — the appLink variant, with no intake surface', async () => {
    expect(target(await call('https://app.example.com/p/tok?cycle=cyc-sep'))).toBe('/?cycle=cyc-sep');
  });

  it('still opens the intake surface when no cycle is named (pre-fix links already in inboxes)', async () => {
    expect(target(await call('https://app.example.com/p/tok?intake=1'))).toBe('/?intake=1');
  });

  it('redirects bare, with no query at all, when nothing was asked for', async () => {
    expect(target(await call('https://app.example.com/p/tok'))).toBe('/');
  });

  it('drops intake unless it is exactly 1, and forwards nothing else it was not asked to carry', async () => {
    // `intake=true` is not the marker the emails emit; an unknown param is not this route's to
    // pass on. An allow-list, so a link cannot smuggle state past the token hop.
    expect(target(await call('https://app.example.com/p/tok?intake=true&next=/admin'))).toBe('/');
  });

  it('sends an invalid token to /expired regardless of what it was carrying', async () => {
    h.claims = null;
    expect(target(await call('https://app.example.com/p/tok?intake=1&cycle=cyc-sep'))).toBe('/expired');
    expect(h.cookieCalls).toHaveLength(0);
  });
});
