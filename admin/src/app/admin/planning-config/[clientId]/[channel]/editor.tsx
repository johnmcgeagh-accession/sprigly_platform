'use client';

import { useState, useTransition } from 'react';
import { upsertPlanningConfig } from './actions';
import type {
  Pillar,
  Cadence,
  RecurringSeries,
  PostingTimes,
  SeriesDayOfWeek,
  SeriesFormat,
  SeriesWhoPosts,
} from '@sprigly/engine';

// ── shared styles ──────────────────────────────────────────────────────────────

const inputCls =
  'border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 w-full';
const labelCls = 'block text-xs font-medium text-gray-500 mb-1';
const sectionCls = 'bg-white rounded-lg border border-gray-200 px-6 py-5';
const cardCls = 'border border-gray-200 rounded-lg p-4 space-y-3';

// tsconfig lib:["ES2022"] has no DOM — access element properties via this workaround.
function val(e: { currentTarget: unknown }): string {
  return (e.currentTarget as unknown as { value: string }).value;
}
function numVal(e: { currentTarget: unknown }): number {
  return Number((e.currentTarget as unknown as { value: string }).value);
}

/**
 * Change handlers that read the event SYNCHRONOUSLY.
 *
 * React recycles a synthetic event once the handler returns, nulling currentTarget. A
 * setState UPDATER runs later — React calls it during the render pass, not at the call
 * site — so `setCadence((c) => ({ ...c, min: numVal(e) }))` reads a dead event and throws
 *   TypeError: null is not an object (evaluating 'e.currentTarget.value')
 * the moment anyone types. It is data-independent, which is why it survived a session of
 * shape hardening: nothing about the stored config affects it.
 *
 * These exist as factories rather than inline arrows so the synchronous read is structural
 * — a handler cannot be written the wrong way by accident — and so the recycling can be
 * simulated in a test without a DOM.
 */
export function onCadenceFieldChange(
  set: (updater: (c: Cadence) => Cadence) => void,
  field: keyof Cadence,
): (e: { currentTarget: unknown }) => void {
  return (e) => {
    const v = numVal(e);                       // read NOW, while the event is alive
    set((c) => ({ ...c, [field]: v }));
  };
}

export function onPostingTimeChange(
  set: (updater: (t: PostingTimes) => PostingTimes) => void,
  key: keyof PostingTimes,
): (e: { currentTarget: unknown }) => void {
  return (e) => {
    const v = val(e);                          // read NOW, while the event is alive
    set((t) => ({ ...t, [key]: v }));
  };
}

// ── local state types ─────────────────────────────────────────────────────────

interface PillarState {
  name: string;
  tagline: string;
  keyMessages: string;  // textarea — one entry per line
  contentIdeas: string; // textarea — one entry per line
  /**
   * Carried through the edit round-trip, never edited here.
   *
   * Onboarding derives a share-of-posts percentage per pillar and persists it
   * (onboard.ts:361-365, toConfigPillars). This panel has no field for it, and before this
   * it simply vanished: state→pillar rebuilt the object from the four editable fields, so
   * the first save of an onboarded client silently deleted every sharePct.
   *
   * Optional because BOTH shapes are real: ivy-t predates the persistence and has no
   * sharePct on any of its 7 pillars (verified on prod); an onboarded client has one on all
   * of them. Neither is wrong, and this panel must not invent the value for the former or
   * destroy it for the latter.
   */
  sharePct?: number;
}

interface SeriesState {
  name: string;
  dayOfWeek: SeriesDayOfWeek;
  time: string;
  format: string;           // '' encodes null (Sally owns format)
  whoPosts: SeriesWhoPosts;
}

// ── conversion helpers ────────────────────────────────────────────────────────

function splitLines(s: string): string[] {
  return s.split('\n').map((l) => l.trim()).filter(Boolean);
}

function joinLines(arr: string[]): string {
  return arr.join('\n');
}

function stripAt(handle: string): string {
  return handle.startsWith('@') ? handle.slice(1) : handle;
}

/**
 * Read a stored pillar into edit state.
 *
 * Every field is guarded because the `Pillar` type describes what the writers intend, not
 * what the jsonb column can hold — the same gap that took the client page down through
 * IntakePanel. An array field arriving absent used to reach `undefined.join()` and throw
 * during render, and with no error boundaries on the page (known backlog) that is the whole
 * screen, not one panel.
 */
export function pillarToState(p: Pillar): PillarState {
  const shareOf = (x: Pillar): number | undefined => {
    const v = (x as { sharePct?: unknown }).sharePct;
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const share = shareOf(p);
  return {
    name:         p.name ?? '',
    tagline:      p.tagline ?? '',
    keyMessages:  joinLines(p.keyMessages  ?? []),
    contentIdeas: joinLines(p.contentIdeas ?? []),
    ...(share !== undefined ? { sharePct: share } : {}),
  };
}

export function stateToPillar(s: PillarState): Pillar {
  return {
    name:         s.name.trim(),
    tagline:      s.tagline.trim(),
    keyMessages:  splitLines(s.keyMessages),
    contentIdeas: splitLines(s.contentIdeas),
    // Re-emitted ONLY when it was there. A pillar without a share keeps not having one —
    // inventing a number here would put a made-up weighting in front of the planner.
    ...(s.sharePct !== undefined ? { sharePct: s.sharePct } : {}),
  } as Pillar;
}

/** Same posture as pillarToState: the stored shape is not guaranteed to be the typed one. */
function seriesToState(r: RecurringSeries): SeriesState {
  return {
    name:       r.name ?? '',
    dayOfWeek:  r.dayOfWeek ?? 'Sunday',
    time:       r.time ?? '',
    format:     r.format ?? '',
    whoPosts:   r.whoPosts ?? 'Sprigly',
  };
}

function stateToSeries(s: SeriesState): RecurringSeries {
  return {
    name:      s.name.trim(),
    dayOfWeek: s.dayOfWeek,
    time:      s.time.trim(),
    format:    (s.format || null) as SeriesFormat,
    whoPosts:  s.whoPosts,
  };
}

// ── PillarCard ────────────────────────────────────────────────────────────────

function PillarCard({
  pillar,
  onChange,
  onRemove,
}: {
  pillar: PillarState;
  onChange: (updated: PillarState) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<PillarState>) => onChange({ ...pillar, ...patch });

  return (
    <div className={cardCls}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Name</label>
            <input
              className={inputCls}
              value={pillar.name}
              onChange={(e) => set({ name: val(e) })}
              placeholder="e.g. Simplify Your Morning"
            />
          </div>
          <div>
            <label className={labelCls}>Tagline</label>
            <input
              className={inputCls}
              value={pillar.tagline}
              onChange={(e) => set({ tagline: val(e) })}
              placeholder="The italic line beneath the pillar name"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="mt-5 text-xs text-red-500 hover:text-red-700 whitespace-nowrap"
        >
          Remove
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>
            Key messages{' '}
            <span className="text-gray-400 font-normal">— one per line</span>
          </label>
          <textarea
            className={inputCls}
            rows={4}
            value={pillar.keyMessages}
            onChange={(e) => set({ keyMessages: val(e) })}
            placeholder="One less thing to worry about&#10;Effortless coordination&#10;Streamlined wardrobe decisions"
          />
        </div>
        <div>
          <label className={labelCls}>
            Content ideas{' '}
            <span className="text-gray-400 font-normal">— one per line</span>
          </label>
          <textarea
            className={inputCls}
            rows={4}
            value={pillar.contentIdeas}
            onChange={(e) => set({ contentIdeas: val(e) })}
            placeholder="morning routine&#10;outfit repeating&#10;capsule wardrobe"
          />
        </div>
      </div>
    </div>
  );
}

// ── RecurringSeriesCard ───────────────────────────────────────────────────────

const DAY_OPTIONS: { value: SeriesDayOfWeek; label: string }[] = [
  { value: 'Monday',    label: 'Monday' },
  { value: 'Tuesday',   label: 'Tuesday' },
  { value: 'Wednesday', label: 'Wednesday' },
  { value: 'Thursday',  label: 'Thursday' },
  { value: 'Friday',    label: 'Friday' },
  { value: 'Saturday',  label: 'Saturday' },
  { value: 'Sunday',    label: 'Sunday' },
  { value: 'monthly',   label: 'Monthly (no fixed day)' },
];

const FORMAT_OPTIONS: { value: string; label: string }[] = [
  { value: '',                 label: '— none (Sally owns) —' },
  { value: 'Reel',             label: 'Reel' },
  { value: 'Carousel',         label: 'Carousel' },
  { value: 'Static',           label: 'Static' },
  { value: 'Reel or Carousel', label: 'Reel or Carousel' },
];

const WHO_OPTIONS: { value: SeriesWhoPosts; label: string }[] = [
  { value: 'Sprigly',      label: 'Sprigly' },
  { value: 'Sally posting', label: 'Sally posting' },
  { value: 'Sally only',   label: 'Sally only' },
];

function RecurringSeriesCard({
  series,
  onChange,
  onRemove,
}: {
  series: SeriesState;
  onChange: (updated: SeriesState) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<SeriesState>) => onChange({ ...series, ...patch });

  return (
    <div className={cardCls}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <label className={labelCls}>Series name</label>
          <input
            className={inputCls}
            value={series.name}
            onChange={(e) => set({ name: val(e) })}
            placeholder="e.g. Sunday Style"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="mt-5 text-xs text-red-500 hover:text-red-700 whitespace-nowrap"
        >
          Remove
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className={labelCls}>Day / frequency</label>
          <select
            className={inputCls}
            value={series.dayOfWeek}
            onChange={(e) => set({ dayOfWeek: val(e) as SeriesDayOfWeek })}
          >
            {DAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>
            Time{' '}
            <span className="text-gray-400 font-normal">— e.g. 8pm, monthly</span>
          </label>
          <input
            className={inputCls}
            value={series.time}
            onChange={(e) => set({ time: val(e) })}
            placeholder="8pm"
          />
        </div>

        <div>
          <label className={labelCls}>Format</label>
          <select
            className={inputCls}
            value={series.format}
            onChange={(e) => set({ format: val(e) })}
          >
            {FORMAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>Who posts</label>
          <select
            className={inputCls}
            value={series.whoPosts}
            onChange={(e) => set({ whoPosts: val(e) as SeriesWhoPosts })}
          >
            {WHO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

// ── StringListSection ─────────────────────────────────────────────────────────
// Used for both Competitors and Categories — simple add/remove string rows.

function StringListSection({
  items,
  onChange,
  placeholder,
  addLabel,
}: {
  items: string[];
  onChange: (updated: string[]) => void;
  placeholder: string;
  addLabel: string;
}) {
  function update(i: number, v: string) {
    onChange(items.map((x, idx) => (idx === i ? v : x)));
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...items, '']);
  }

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={inputCls}
            value={item}
            onChange={(e) => update(i, val(e))}
            placeholder={placeholder}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-xs text-red-500 hover:text-red-700 whitespace-nowrap"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-sm text-blue-600 hover:underline"
      >
        {addLabel}
      </button>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export interface InitialPlanningConfig {
  pillars: Pillar[];
  competitors: string[];
  cadence: Cadence;
  recurringSeries: RecurringSeries[];
  postingTimes: PostingTimes;
  categories: string[];
}

interface Props {
  clientId: string;
  clientName: string;
  channel: string;
  initial: InitialPlanningConfig;
}

export function PlanningConfigEditor({ clientId, clientName, channel, initial }: Props) {
  const [pillars, setPillars] = useState<PillarState[]>(() =>
    initial.pillars.map(pillarToState),
  );
  const [series, setSeries] = useState<SeriesState[]>(() =>
    initial.recurringSeries.map(seriesToState),
  );
  const [competitors, setCompetitors] = useState<string[]>(initial.competitors);
  const [categories, setCategories] = useState<string[]>(initial.categories);

  const [cadence, setCadence] = useState<Cadence>(
    initial.cadence.postsPerMonthMin !== undefined
      ? initial.cadence
      : { postsPerMonthMin: 16, postsPerMonthMax: 20, maxPerWeek: 5, minPerWeek: 3 },
  );
  const [postingTimes, setPostingTimes] = useState<PostingTimes>(
    initial.postingTimes.launch !== undefined
      ? initial.postingTimes
      : { launch: '6am', morning: '7am', evening: '7pm', wsg: '6pm', sundayStyle: '8pm' },
  );

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [isPending, startTransition] = useTransition();

  function addPillar() {
    setPillars((prev) => [
      ...prev,
      { name: '', tagline: '', keyMessages: '', contentIdeas: '' },
    ]);
  }

  function addSeries() {
    setSeries((prev) => [
      ...prev,
      { name: '', dayOfWeek: 'Sunday', time: '', format: '', whoPosts: 'Sprigly' },
    ]);
  }

  function handleSave() {
    setSaveStatus('idle');
    setSaveError('');

    const payload = {
      pillars:         pillars.map(stateToPillar),
      competitors:     competitors.map(stripAt).filter(Boolean),
      cadence,
      recurringSeries: series.map(stateToSeries),
      postingTimes,
      categories:      categories.map((c) => c.trim()).filter(Boolean),
    };

    startTransition(async () => {
      const result = await upsertPlanningConfig(clientId, channel, payload);
      if (result.ok) {
        setSaveStatus('saved');
      } else {
        setSaveStatus('error');
        setSaveError(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">

      {/* Pillars */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-gray-900">Content pillars</h2>
          <button type="button" onClick={addPillar} className="text-sm text-blue-600 hover:underline">
            + Add pillar
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Define the strategic themes that govern {clientName}&apos;s content.
          Key messages and content ideas: one entry per line.
        </p>
        {pillars.length === 0 ? (
          <p className="text-sm text-gray-400">No pillars yet.</p>
        ) : (
          <div className="space-y-3">
            {pillars.map((p, i) => (
              <PillarCard
                key={i}
                pillar={p}
                onChange={(updated) => setPillars((prev) => prev.map((x, idx) => (idx === i ? updated : x)))}
                onRemove={() => setPillars((prev) => prev.filter((_, idx) => idx !== i))}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recurring series */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-gray-900">Recurring series</h2>
          <button type="button" onClick={addSeries} className="text-sm text-blue-600 hover:underline">
            + Add series
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Fixed weekly or monthly series carried forward in each plan. Format &quot;none&quot; means
          Sally owns the format and no Sprigly brief is generated for that field.
        </p>
        {series.length === 0 ? (
          <p className="text-sm text-gray-400">No recurring series yet.</p>
        ) : (
          <div className="space-y-3">
            {series.map((s, i) => (
              <RecurringSeriesCard
                key={i}
                series={s}
                onChange={(updated) => setSeries((prev) => prev.map((x, idx) => (idx === i ? updated : x)))}
                onRemove={() => setSeries((prev) => prev.filter((_, idx) => idx !== i))}
              />
            ))}
          </div>
        )}
      </div>

      {/* Competitors */}
      <div className={sectionCls}>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Competitors</h2>
        <p className="text-xs text-gray-400 mb-4">
          Instagram handles to track in competitor analysis. Leading @ is stripped on save.
        </p>
        <StringListSection
          items={competitors}
          onChange={setCompetitors}
          placeholder="organicbasics"
          addLabel="+ Add competitor"
        />
      </div>

      {/* Categories */}
      <div className={sectionCls}>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Categories</h2>
        <p className="text-xs text-gray-400 mb-4">
          Authoritative vocabulary for the Category column in the plan CSV and Excel workbook.
          The planning agent must only use values from this list — add new categories here first.
        </p>
        <StringListSection
          items={categories}
          onChange={setCategories}
          placeholder="Styling"
          addLabel="+ Add category"
        />
      </div>

      {/* Cadence */}
      <div className={sectionCls}>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Posting cadence</h2>
        <div className="grid grid-cols-4 gap-4 max-w-xl">
          <div>
            <label className={labelCls}>Posts/month min</label>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={cadence.postsPerMonthMin}
              onChange={onCadenceFieldChange(setCadence, 'postsPerMonthMin')}
            />
          </div>
          <div>
            <label className={labelCls}>Posts/month max</label>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={cadence.postsPerMonthMax}
              onChange={onCadenceFieldChange(setCadence, 'postsPerMonthMax')}
            />
          </div>
          <div>
            <label className={labelCls}>Min posts/week</label>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={cadence.minPerWeek}
              onChange={onCadenceFieldChange(setCadence, 'minPerWeek')}
            />
          </div>
          <div>
            <label className={labelCls}>Max posts/week</label>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={cadence.maxPerWeek}
              onChange={onCadenceFieldChange(setCadence, 'maxPerWeek')}
            />
          </div>
        </div>
      </div>

      {/* Posting times */}
      <div className={sectionCls}>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Posting times</h2>
        <p className="text-xs text-gray-400 mb-4">
          Standard time slots referenced in the plan. Freeform strings, e.g. &quot;6am&quot;, &quot;8pm&quot;.
        </p>
        <div className="grid grid-cols-5 gap-3 max-w-2xl">
          {(
            [
              { key: 'launch',      label: 'Launch' },
              { key: 'morning',     label: 'Morning' },
              { key: 'evening',     label: 'Evening' },
              { key: 'wsg',         label: 'WSG' },
              { key: 'sundayStyle', label: 'Sunday Style' },
            ] as const
          ).map(({ key, label }) => (
            <div key={key}>
              <label className={labelCls}>{label}</label>
              <input
                className={inputCls}
                value={postingTimes[key]}
                onChange={onPostingTimeChange(setPostingTimes, key)}
                placeholder="7pm"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="px-6 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        {saveStatus === 'saved' && (
          <span className="text-sm text-green-600">Saved successfully.</span>
        )}
        {saveStatus === 'error' && (
          <span className="text-sm text-red-600">Error: {saveError}</span>
        )}
      </div>
    </div>
  );
}
