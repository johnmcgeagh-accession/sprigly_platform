export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Failed posts — the operator half of spec gap 7.
 *
 * The client surface no longer offers a retry: a post still being written reads as "on its
 * way", and nothing is asked of the client. Two things have to be true for that to be honest.
 * The system has to keep trying (the daily sweep, engine/.../generation-sweep.ts), and what it
 * cannot recover has to reach a person. Before this, `generation_failed` appeared NOWHERE in
 * admin — the state was terminal, client-visible, and invisible to us.
 *
 * This is the second half and nothing more: one list, the existing admin table pattern, no
 * design ambition. It answers who, which month, which post, what went wrong, and how many
 * passes the sweep has spent — and, from those, whether anything is still going to happen.
 *
 * READ-ONLY. There is deliberately no "retry" button here: the sweep owns re-enqueuing, and a
 * second door onto the same spend, on a page whose whole purpose is to show that the first door
 * ran out, would be a way to lose track of what has been paid for. When a post reaches Yours,
 * the fix is a real one — the brief, the catalogue, the model — not another go.
 */
import { db, contentCyclePosts, contentCycles, clients } from '@sprigly/db';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { MAX_SWEEP_ATTEMPTS } from '@sprigly/engine/generation-recovery';
import { verdictFor, type Verdict } from '@/lib/failed-post-verdict';

/** London's calendar day — the same boundary the sweep and the client's edit gate use. */
function londonToday(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function metaStr(sourceMeta: unknown, key: string): string {
  if (!sourceMeta || typeof sourceMeta !== 'object') return '';
  const v = (sourceMeta as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
}

const TONE: Record<Verdict['tone'], string> = {
  waiting: 'bg-gray-100 text-gray-700',
  ours:    'bg-amber-100 text-amber-800',
  yours:   'bg-red-100 text-red-700',
};

async function getFailedPosts() {
  return db
    .select({
      id:            contentCyclePosts.id,
      scheduledDate: contentCyclePosts.scheduledDate,
      format:        contentCyclePosts.format,
      pillar:        contentCyclePosts.pillar,
      sourceMeta:    contentCyclePosts.sourceMeta,
      cycleMonth:    contentCycles.cycleMonth,
      cycleId:       contentCycles.id,
      clientName:    clients.name,
    })
    .from(contentCyclePosts)
    .innerJoin(contentCycles, eq(contentCyclePosts.cycleId, contentCycles.id))
    .innerJoin(clients, eq(contentCyclePosts.clientId, clients.id))
    .where(and(
      eq(contentCyclePosts.status, 'generation_failed'),
      isNull(contentCyclePosts.deletedAt),
    ))
    .orderBy(desc(contentCyclePosts.scheduledDate))
    .limit(200);
}

export default async function FailedPostsPage() {
  const [rows, today] = await Promise.all([getFailedPosts(), Promise.resolve(londonToday())]);
  const yours = rows.filter((r) => verdictFor(r.sourceMeta, r.scheduledDate, today).tone === 'yours').length;

  return (
    <div className="max-w-6xl">
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Failed Posts</h1>
      <p className="mb-6 max-w-3xl text-sm text-gray-500">
        Posts whose caption generation ran out of attempts. The client never sees this — their surface
        says <em>“on its way”</em> and offers no retry, so this page is the only place a stuck post is
        visible. Each post gets up to {MAX_SWEEP_ATTEMPTS} sweep passes on the 05:00 tick (three paid
        attempts each) before it stops costing anything and becomes <strong>yours</strong>. Read-only:
        the sweep owns re-enqueuing.
      </p>

      <div className="mb-5 flex gap-6 text-sm">
        <span className="text-gray-700"><strong>{rows.length}</strong> failed {rows.length === 1 ? 'post' : 'posts'}</span>
        <span className={yours > 0 ? 'font-semibold text-red-700' : 'text-gray-400'}>
          <strong>{yours}</strong> need you
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
          Nothing failed. Every generated post has its caption.
        </div>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-gray-400">
            <tr>
              <th className="py-2 pr-3 font-medium">Client</th>
              <th className="py-2 pr-3 font-medium">Month</th>
              <th className="py-2 pr-3 font-medium">Post</th>
              <th className="py-2 pr-3 font-medium">What went wrong</th>
              <th className="py-2 pr-3 font-medium">Next</th>
            </tr>
          </thead>
          <tbody className="text-gray-700">
            {rows.map((r) => {
              const verdict = verdictFor(r.sourceMeta, r.scheduledDate, today);
              const title = metaStr(r.sourceMeta, 'title');
              const error = metaStr(r.sourceMeta, 'generationError');
              return (
                <tr key={r.id} className="border-t border-gray-100 align-top">
                  <td className="py-3 pr-3 font-medium text-gray-900">{r.clientName}</td>
                  <td className="py-3 pr-3 whitespace-nowrap font-mono text-xs text-gray-500">{r.cycleMonth}</td>
                  <td className="py-3 pr-3">
                    <div className="font-medium text-gray-900">{title || <span className="italic text-gray-400">untitled</span>}</div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {r.scheduledDate} · {r.format}{r.pillar ? ` · ${r.pillar}` : ''}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-gray-300">{r.id}</div>
                  </td>
                  <td className="py-3 pr-3 max-w-md">
                    {error
                      ? <span className="font-mono text-xs text-gray-600">{error}</span>
                      : <span className="text-xs italic text-gray-400">no reason recorded</span>}
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${TONE[verdict.tone]}`}>{verdict.label}</span>
                    <div className="mt-1 text-xs text-gray-400">{verdict.detail}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
