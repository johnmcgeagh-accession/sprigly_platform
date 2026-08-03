/**
 * Month-by-month adoption and divergence for one client + channel.
 *
 * The table is the artefact; the chart is a reading aid and is drawn only from months that have
 * an answer. A bar of height zero for a month we never trawled would be a lie told in pixels —
 * the same lie the panel refuses to tell in words — so unmeasured months carry a hatched slot
 * and their reason, and never a bar.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, clients } from '@sprigly/db';
import { eq } from 'drizzle-orm';
import { asPercent, ADOPTION_MATCH_THRESHOLD, type MonthHealth } from '@sprigly/engine/caption-overlap';
import { getClientHealth } from '@/lib/client-health';

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y!, mo! - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/** Every state named, none reached by falling off the end — see ClientHealthPanel's Unmeasured
 *  for why the `never` is worth the extra lines. */
function reasonFor(h: Exclude<MonthHealth, { state: 'measured' }>): string {
  switch (h.state) {
    case 'not_trawled': return 'not trawled';
    case 'no_captions': return 'no captions';
    case 'no_plan':     return 'no plan to compare';
    default: {
      const unhandled: never = h;
      throw new Error(`unhandled month state: ${JSON.stringify(unhandled)}`);
    }
  }
}

export default async function ClientHealthPage(
  { params }: { params: { id: string; channel: string } },
) {
  const client = (await db.select().from(clients).where(eq(clients.id, params.id)).limit(1))[0];
  if (!client) notFound();

  const health = await getClientHealth(params.id, params.channel);
  // Oldest first for the chart — a trend reads left to right — newest first for the table, where
  // the operator is looking for "what happened last month".
  const chronological = [...health.months].sort((a, b) => a.month.localeCompare(b.month));
  const measured = health.months.filter((m): m is Extract<MonthHealth, { state: 'measured' }> => m.state === 'measured');

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/admin/clients/${params.id}`} className="text-sm text-blue-600 hover:underline">
          ← {client.name}
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Adoption &amp; divergence</h1>
        <p className="text-sm text-gray-500 mt-1">
          <span className="font-mono">{params.channel}</span> · match threshold{' '}
          <span className="tabular-nums">{Math.round(ADOPTION_MATCH_THRESHOLD * 100)}%</span> word overlap ·
          compared against {health.poolSize} planned {health.poolSize === 1 ? 'post' : 'posts'}
        </p>
      </div>

      {health.months.length === 0 ? (
        <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
          <p className="text-sm text-gray-500">
            No Instagram posts have been trawled for this channel, so there is nothing to measure.
          </p>
        </section>
      ) : (
        <>
          {/* ── The chart. CSS bars, no library — the data is ten numbers. ── */}
          <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Adoption over time</h2>
            <p className="text-xs text-gray-400 mb-5">
              Height is the share of that month&rsquo;s published captions that matched a Sprigly one.
              Months without an answer carry no bar.
            </p>
            <div className="flex items-end gap-3 overflow-x-auto pb-2">
              {chronological.map((m) => (
                <div key={m.month} className="flex flex-col items-center gap-2 shrink-0 w-16">
                  <div className="flex items-end w-full h-32">
                    {m.state === 'measured' ? (
                      <div
                        className="w-full rounded-t bg-blue-600"
                        // The ONLY inline style here, and it is the one thing Tailwind cannot
                        // express: a height that is the datum. The 1.5% floor keeps a measured
                        // 0% visible as a bar — an invisible bar and an absent one would read
                        // the same, and they mean different things.
                        style={{ height: `${Math.max(m.adoption * 100, 1.5)}%` }}
                        title={`${m.matched} of ${m.published}`}
                      />
                    ) : (
                      <div
                        className="w-full h-full rounded-t border border-dashed border-gray-200 bg-gray-50"
                        title={reasonFor(m)}
                      />
                    )}
                  </div>
                  <p className="text-xs tabular-nums text-gray-700">
                    {m.state === 'measured'
                      ? `${Math.round(m.adoption * 100)}%`
                      : <span className="text-gray-300">—</span>}
                  </p>
                  <p className="text-[10px] text-gray-400 text-center leading-tight">{monthLabel(m.month)}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── The table. ── */}
          <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Month by month</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-200">
                    <th className="pb-2 pr-4 font-medium">Month</th>
                    <th className="pb-2 pr-4 font-medium text-right">Published</th>
                    <th className="pb-2 pr-4 font-medium text-right">Matched</th>
                    <th className="pb-2 pr-4 font-medium text-right">Adoption</th>
                    <th className="pb-2 pr-4 font-medium text-right">Divergence</th>
                    <th className="pb-2 font-medium">&nbsp;</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {health.months.map((m) => (
                    <tr key={m.month} className="text-gray-900">
                      <td className="py-2.5 pr-4 whitespace-nowrap">{monthLabel(m.month)}</td>
                      {m.state === 'measured' ? (
                        <>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{m.published}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{m.matched}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{asPercent(m.adoption)}%</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">
                            {m.divergence === null
                              ? <span className="text-gray-300">—</span>
                              : `${asPercent(m.divergence)}%`}
                          </td>
                          <td className="py-2.5 text-xs text-gray-400">
                            {m.divergence === null && m.published > 0 && 'nothing matched'}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-2.5 pr-4 text-right tabular-nums text-gray-400">
                            {m.state === 'not_trawled' ? '—' : m.published}
                          </td>
                          {/* Three dashes, not three zeroes. The month has no answer, and an
                              empty cell is the only honest way to render one. */}
                          <td className="py-2.5 pr-4 text-right text-gray-300">—</td>
                          <td className="py-2.5 pr-4 text-right text-gray-300">—</td>
                          <td className="py-2.5 pr-4 text-right text-gray-300">—</td>
                          <td className="py-2.5 text-xs text-gray-400">{reasonFor(m)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {measured.length === 0 && (
              <p className="mt-4 text-sm text-gray-500">
                No month has both trawled captions and a plan to compare them against yet.
              </p>
            )}
          </section>
        </>
      )}

      {/* ── The method, again, where the trend is read. ── */}
      <section className="bg-white rounded-lg border border-gray-200 px-6 py-5 space-y-3">
        <h2 className="text-base font-semibold text-gray-900">What these numbers are</h2>
        <p className="text-sm text-gray-600">
          <span className="font-medium">Adoption</span> — of the captions published on this channel
          in a calendar month, the share whose words match something Sprigly wrote. The comparison
          is textual: Instagram gives us no post id and no permalink, so nothing joins a published
          post to a planned one. A caption counts as ours when at least{' '}
          <span className="tabular-nums">{Math.round(ADOPTION_MATCH_THRESHOLD * 100)}%</span> of its
          words appear in one of our versions of any planned post.
        </p>
        <p className="text-sm text-gray-600">
          <span className="font-medium">Divergence</span> — for the matched posts only, the average
          share of the published caption that is <em>not</em> our words. Rising divergence means our
          captions are being used but rewritten more heavily. A post that matched nothing moves
          adoption and never touches divergence: the two measures are independent by construction.
        </p>
        <p className="text-sm text-gray-600">
          <span className="font-medium">Whose words count as ours</span> — the generated caption,
          plus any rewrite the client asked us for. A caption she typed herself into the plan is
          excluded, because matching a published post against her own writing would score her work
          as our adoption. A rewrite she instructed is <em>not</em> divergence: she asked, we wrote
          it, and it is measured from what we last wrote rather than from the first draft.
        </p>
        <p className="text-sm text-gray-500">
          <span className="font-medium text-gray-600">A floor, not a measurement.</span> Heavy
          rewrites of our own captions fall below the threshold and read as unmatched, so the real
          adoption figure is at least what is shown and probably higher. This stays true until the
          Meta Graph API gives us a post id to join on.
        </p>
      </section>
    </div>
  );
}
