/**
 * ClientHealthPanel.tsx — the two numbers, on the client's page.
 *
 * Rules this panel exists to keep, all of them the same rule:
 *
 *   NEVER A BARE PERCENTAGE. "27.8%" is a claim; "10 of 36 · 27.8%" is a fact with its own
 *   sample attached. The denominator is rendered first and at the same weight, because 1 of 1 and
 *   30 of 30 are both 100% and only one of them means anything.
 *
 *   NEVER 0% WHERE THE ANSWER IS "WE DON'T KNOW". A month with no trawl, a month with no
 *   captions, and a month we never planned each say so in their own words. This is the same
 *   distinction the draft evidence protects with `lastFeatured: null`.
 *
 *   THE METHOD IS ON THE SCREEN. Not in a doc the operator will not open — in the panel, under
 *   the numbers, saying that the match is textual and that the figure is a floor.
 *
 * Presentational and synchronous: the page does the reading (`admin/src/lib/client-health.ts`).
 */
import Link from 'next/link';
import { asPercent, type MonthHealth } from '@sprigly/engine/caption-overlap';

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y!, mo! - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/** "10 of 36 · 27.8%" — the count leads, always. */
function Ratio({ n, of, label }: { n: number; of: number; label: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-gray-900">
        <span className="text-2xl font-semibold tabular-nums">{n}</span>
        <span className="text-sm text-gray-500"> of {of}</span>
        <span className="ml-2 text-sm text-gray-500 tabular-nums">· {asPercent(n / of)}%</span>
      </p>
    </div>
  );
}

/** Divergence has no natural denominator of its own — it is a mean over the matched pairs — so
 *  it carries that count instead. A mean of one pair is not a trend and must not read like one. */
function Divergence({ value, over }: { value: number | null; over: number }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-400">Divergence</p>
      {value === null ? (
        <p className="mt-1 text-sm text-gray-400">Nothing matched — no pairs to measure.</p>
      ) : (
        <p className="mt-1 text-gray-900">
          <span className="text-2xl font-semibold tabular-nums">{asPercent(value)}%</span>
          <span className="text-sm text-gray-500"> across {over} matched {over === 1 ? 'post' : 'posts'}</span>
        </p>
      )}
    </div>
  );
}

/**
 * The not-a-number states, in the operator's words rather than the type's.
 *
 * Every state is named, none reached by falling off the end of a ternary. A `default` here would
 * mean a state added later renders someone else's sentence — which is the same failure as
 * rendering 0%, only harder to spot. The `never` makes it a compile error instead.
 */
function Unmeasured({ health }: { health: Exclude<MonthHealth, { state: 'measured' }> }) {
  let said: string;
  switch (health.state) {
    case 'not_trawled':
      said = 'No Instagram posts have been trawled for this month, so there is nothing to measure yet.';
      break;
    case 'no_captions':
      said = `${health.published} post${health.published === 1 ? '' : 's'} trawled, none with a caption — nothing to compare.`;
      break;
    case 'no_plan':
      said = `${health.published} caption${health.published === 1 ? '' : 's'} published, but no Sprigly caption exists to compare them against.`;
      break;
    default: {
      const unhandled: never = health;
      throw new Error(`unhandled month state: ${JSON.stringify(unhandled)}`);
    }
  }
  return <p className="text-sm text-gray-500">{said}</p>;
}

function MonthBlock({ health }: { health: MonthHealth }) {
  if (health.state !== 'measured') return <Unmeasured health={health} />;
  return (
    <div className="flex flex-wrap gap-x-12 gap-y-4">
      <Ratio n={health.matched} of={health.published} label="Adoption" />
      <Divergence value={health.divergence} over={health.matched} />
    </div>
  );
}

export function ClientHealthPanel({
  clientId,
  channel,
  showChannel,
  current,
  latestMeasured,
  poolSize,
  poolWithoutSpriglyText,
}: {
  clientId:  string;
  channel:   string;
  showChannel: boolean;
  current:   MonthHealth;
  /** The most recent month that HAS an answer, when the current one does not. The trawl runs
   *  monthly and lands after the month closes, so the current month is usually empty — that is a
   *  reason to say so and then show the last real answer, not a reason to show nothing. */
  latestMeasured: MonthHealth | null;
  poolSize:  number;
  poolWithoutSpriglyText: number;
}) {
  // ALWAYS shown when it exists, not only when the current month is empty. The current month is
  // partial by definition — the trawl runs monthly, so on the 3rd it holds one post and reads as
  // an honest "0 of 1", which is true and useless. Putting the last complete month beside it
  // costs a strip of the panel and stops the operator drawing a trend from a sample of one.
  const showFallback = latestMeasured !== null;

  return (
    <section className="bg-white rounded-lg border border-gray-200 px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Adoption &amp; divergence</h2>
          <p className="text-xs text-gray-400 mt-1">
            {monthLabel(current.month)}
            {showChannel && <> · <span className="font-mono">{channel}</span></>}
          </p>
        </div>
        <Link
          href={`/admin/clients/${clientId}/health/${channel}`}
          className="text-sm text-blue-600 hover:underline shrink-0"
        >
          Month by month →
        </Link>
      </div>

      <div className="mt-4">
        <MonthBlock health={current} />
      </div>

      {showFallback && (
        <div className="mt-5 pt-4 border-t border-gray-100">
          <p className="text-xs uppercase tracking-wide text-gray-400 mb-3">
            Last complete month — {monthLabel(latestMeasured!.month)}
          </p>
          <MonthBlock health={latestMeasured!} />
        </div>
      )}

      {/* THE METHOD, where the operator reads the numbers. Not a tooltip, not a doc. */}
      <div className="mt-5 pt-4 border-t border-gray-100 space-y-2">
        <p className="text-xs text-gray-500">
          <span className="font-medium text-gray-600">How this is measured.</span>{' '}
          Instagram gives us no post id, so there is no join between a post she published and the
          post we planned — the match is on the WORDS. A published caption counts as ours when at
          least 85% of its words appear in something Sprigly wrote for her: the generated caption,
          any rewrite she asked us for, or the plan caption where she has never typed into it.
          Divergence is the share of a matched caption that is not our words, averaged over the
          matched posts only.
        </p>
        <p className="text-xs text-gray-500">
          <span className="font-medium text-gray-600">Read it as a floor, not a measurement.</span>{' '}
          A caption she rewrote heavily reads as unmatched even when it started as ours, so the
          true figure is at least this and probably higher. It stays approximate until the Meta
          Graph API gives us a real post id.
        </p>
        <p className="text-xs text-gray-400">
          Compared against {poolSize} planned {poolSize === 1 ? 'post' : 'posts'} for this channel
          {poolWithoutSpriglyText > 0 && (
            <> · {poolWithoutSpriglyText} excluded: the caption on file is the client&rsquo;s own text, not ours</>
          )}
        </p>
      </div>
    </section>
  );
}
