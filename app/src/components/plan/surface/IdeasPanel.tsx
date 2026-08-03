'use client';

/**
 * IdeasPanel.tsx — the client's own sentences, and what became of each. (W6)
 *
 * ── Notes, with the missing half built ───────────────────────────────────────────────
 *
 * `PlanDesktop` had a Notes view: a column of things the client had said, in order, and nothing
 * else. The desktop rebuild dropped it on the argument that the conversation thread is already
 * the record of what was said — which is true, and which answers the smaller half of the
 * question. A client who says "make Fridays more personal" in July is not asking to be shown
 * their own sentence back. They are asking whether it ever became anything.
 *
 * So this is Notes' successor with that half built. Every durable input, in her words, each
 * carrying the state the data already knows and — where a beat recorded the link — the post it
 * turned into.
 *
 * ── Read-only, and that is the design ────────────────────────────────────────────────
 *
 * There is no add button, no edit, no delete. The way to add an idea is to tell the agent, which
 * is the path that already exists, already understands "actually, not that one", and already
 * files what it hears. A second capture surface here would be a second way to say the same thing
 * with different rules, and the surface has been through that before (round 3's two navigation
 * systems). The one control on the panel is a tap-through to a post.
 *
 * The states are DERIVED from `status` and `lifecycle` and never stored — `@/lib/ideas` is the
 * whole rule, and it is pure so this file can be rendered in a test without a database.
 *
 * ── At width ─────────────────────────────────────────────────────────────────────────
 *
 * The same two-column flow Tasks uses in the same region slot, for the same reason and by the
 * same mechanism: the state groups are different heights, so multi-column beats a grid, and
 * `break-inside-avoid` keeps a group whole. Two columns of a 1120px region land near 520px each,
 * which is still a comfortable measure for a sentence someone wrote by voice.
 */
import React from 'react';
import { scrollPad, type SurfaceFrame } from './frame';
import type { PlanData } from '../usePlanData';
import { ideaStateLabel, type IdeaState, type IdeaView } from '@/lib/ideas';
import { ChevronR } from './icons';

/**
 * The empty state keeps the old Notes' framing verbatim, including the example. It is the one
 * piece of that view worth carrying: it does not say "no ideas yet" (which reads as a failure to
 * do something) — it says what saying something DOES, which is the only thing a client needs to
 * know here, and it teaches the add path by demonstrating it.
 */
const EMPTY_HEAD = 'Nothing here yet';
const EMPTY_BODY = 'When you tell Sprigly things like “make Fridays more personal”, they’re captured here.';

/** The groups, in reading order: what is still live, then what is finished. */
const GROUPS: [IdeaState, string, string][] = [
  ['waiting',   'Waiting',   'On record. Not used yet, and not turned down.'],
  ['deferred',  'Next month', 'You asked us to hold these for the month after this one.'],
  ['used',      'Used',      'These became posts.'],
  ['set-aside', 'Set aside', 'Either you turned these down, or their moment passed.'],
];

export function IdeasPanel({
  data, onOpen, frame = 'desktop',
}: {
  data: PlanData;
  /** Open the post an idea became. Only ever called with an id the plan already holds. */
  onOpen: (postId: string) => void;
  frame?: SurfaceFrame;
}) {
  const desktop = frame === 'desktop';
  const { ideas, ideasError } = data;

  /**
   * The tap-through is offered only for a post THIS view already has. A beat's `sourceRef`
   * points at whatever post the assembler wrote, which may sit in a month the client is not
   * looking at — and `onOpen` resolves ids against the loaded plan, so offering it there would
   * be a control that visibly does nothing. Where the post is out of view the title is still
   * shown, as text: the fact survives, the dead end does not.
   */
  const loaded = new Set(data.calendarPosts.map((p) => p.id));

  return (
    <div
      data-testid="ideas-panel"
      className={`flex-1 overflow-y-auto pt-3 [scrollbar-width:none] ${scrollPad(frame)} ${
        desktop ? 'px-1 wide:columns-2 wide:gap-7' : 'px-5'
      }`}
    >
      {ideasError && (
        <p data-testid="ideas-error" className="mx-1 mb-3 rounded-xl border border-line/40 px-3 py-2.5 text-[13px] leading-normal text-muted">
          We couldn’t load these just now. Nothing has been lost — reload the page to try again.
        </p>
      )}

      {ideas.length === 0 && !ideasError && (
        <div data-testid="ideas-empty" className="mx-6 my-10 text-center">
          <span className="mb-2 block text-[22px] font-bold tracking-[-.02em] text-chrome">{EMPTY_HEAD}</span>
          <span className="text-[13.5px] leading-relaxed text-muted">{EMPTY_BODY}</span>
        </div>
      )}

      {GROUPS.map(([state, label, blurb]) => {
        const items = ideas.filter((i) => i.state === state);
        if (items.length === 0) return null;
        return (
          <section key={state} data-testid="ideas-group" data-state={state} className={`mb-[18px] ${desktop ? 'break-inside-avoid' : ''}`}>
            <div className="flex items-center gap-2.5 pb-1 pt-1">
              <h3 className={`text-[11px] font-bold uppercase tracking-[.1em] ${state === 'set-aside' ? 'text-muted' : 'text-chrome'}`}>
                {label}
              </h3>
              <span className="rounded-full bg-line/20 px-2 py-px text-[11px] font-bold tabular-nums text-muted">{items.length}</span>
            </div>
            {/* The heading names the group; this says what the group MEANS. Four words of state
                with no explanation is a filing system, and a client did not ask for one. */}
            <p className="pb-2 text-[12.5px] leading-normal text-muted">{blurb}</p>
            {items.map((idea) => (
              <IdeaRow key={idea.id} idea={idea} onOpen={idea.postId && loaded.has(idea.postId) ? onOpen : undefined} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

/**
 * One idea. Her words lead, at reading size and weight — everything else on the row is smaller
 * and quieter, because the sentence is the content and the state is the annotation. The quotation
 * marks are real: this text was not written for a screen and is not being paraphrased into one.
 */
function IdeaRow({ idea, onOpen }: { idea: IdeaView; onOpen?: ((postId: string) => void) | undefined }) {
  const label = ideaStateLabel(idea.state, idea.usedInMonth);
  return (
    <div data-testid="idea-row" data-state={idea.state} className="border-b border-line/25 py-2.5 last:border-b-0">
      <p className="break-words text-[14px] leading-[1.45] text-chrome">“{idea.content}”</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span data-testid="idea-state" className={`text-[12px] font-semibold ${idea.state === 'used' ? 'text-coral-700' : 'text-muted'}`}>
          {label}
        </span>

        {/* The beat it became. A separate control from the state word rather than a link on it,
            so "Used in August" stays a statement you can read and the tap target is a thing you
            can see the edges of. */}
        {idea.postTitle && onOpen && idea.postId && (
          <button
            type="button" data-testid="idea-post"
            onClick={() => onOpen(idea.postId!)}
            className="flex min-h-[32px] min-w-0 max-w-full items-center gap-1 rounded-lg bg-line/15 px-2 py-1 text-left text-[12px] text-chrome"
          >
            <span className="truncate">{idea.postTitle}</span>
            <ChevronR className="h-3.5 w-3.5 flex-none text-muted" />
          </button>
        )}

        {/* Out of view: the fact without the affordance. */}
        {idea.postTitle && !onOpen && (
          <span data-testid="idea-post-text" className="min-w-0 truncate text-[12px] text-muted">{idea.postTitle}</span>
        )}
      </div>
    </div>
  );
}
