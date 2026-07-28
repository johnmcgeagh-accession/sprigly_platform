'use client';

/**
 * ThemeForm.tsx — the create affordance the Themes page did not have.
 *
 * The gap this closes: `page.tsx` listed themes and offered Activate, and that was all. Every
 * theme in the table got there through migration 0079's seed, so "create Sprigly Mint in admin →
 * Themes" was an instruction for a screen that did not exist.
 *
 * ── Two things it does that a hand-rolled form would not ─────────────────────────────
 *
 * THE FIELDS COME FROM THE PLATFORM. They are `THEME_TOKEN_KEYS`, the same list `theme.ts`
 * injects as `--t-*`. Not a copy of it — the actual export. A tier added to the ramp appears
 * here without anyone remembering to add it, which is the failure mode that made this fix
 * necessary in the first place.
 *
 * IT PREFILLS FROM THE ACTIVE THEME. A new theme is nearly always a variant of the live one, and
 * sixteen blank hex fields is a form nobody finishes. The prefill is a starting point, not a
 * default: every value is editable, and the two optional tiers start EMPTY even when the active
 * theme has them, because inheriting an accent-650 you did not choose is how a ramp drifts.
 */
import React, { useState, useTransition } from 'react';
import { THEME_TOKEN_KEYS } from '@sprigly/engine/contrast';
import { createTheme } from './actions';
import { TOKEN_GROUPS, TOKEN_NOTES, isOptionalToken, HEX, type TokenKey } from '@/lib/theme-draft';

type Values = Record<string, string>;

export function ThemeForm({ prefill }: { prefill: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Values>(() => seed(prefill));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setBanner(null);
    start(async () => {
      const r = await createTheme(values);
      if (!r.ok) {
        setErrors(r.errors ?? {});
        setBanner({ tone: 'bad', text: r.error ?? 'Some fields need attention.' });
        return;
      }
      setBanner(r.activatable
        ? { tone: 'ok', text: `Created “${values['name']}”. It is not active yet — press Activate on its card below.` }
        : { tone: 'warn', text: `Created “${values['name']}”, but it will not activate: ${r.gateReason}.` });
      setValues(seed(prefill));
      setOpen(false);
    });
  };

  if (!open) {
    return (
      <div className="mb-6">
        <button onClick={() => { setOpen(true); setBanner(null); }} className="rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-700">
          + New theme
        </button>
        {banner && <Banner {...banner} />}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-end gap-4">
        <Field label="Name" error={errors['name']}>
          <input
            value={values['name'] ?? ''} onChange={(e) => set('name', e.target.value)}
            placeholder="Sprigly Mint"
            className="w-64 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label="Version" error={errors['version']}>
          <input
            value={values['version'] ?? '1'} onChange={(e) => set('version', e.target.value)}
            inputMode="numeric"
            className="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </Field>
        <p className="pb-1.5 text-xs text-gray-400">
          Created inactive. Activation is a separate press, and still gated on accent-800 over accent-100.
        </p>
      </div>

      {TOKEN_GROUPS.map((group) => (
        <fieldset key={group.title} className="mb-4">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{group.title}</legend>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
            {group.keys.map((key) => (
              <TokenInput
                key={key} name={key} value={values[key] ?? ''} error={errors[key]}
                onChange={(v) => set(key, v)}
              />
            ))}
          </div>
        </fieldset>
      ))}

      <div className="flex items-center gap-3 border-t border-gray-100 pt-4">
        <button type="submit" disabled={pending} className="rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50">
          {pending ? 'Creating…' : 'Create theme'}
        </button>
        <button type="button" onClick={() => { setOpen(false); setErrors({}); }} className="rounded-md px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-800">
          Cancel
        </button>
        {banner && <Banner {...banner} inline />}
      </div>
    </form>
  );
}

/** One tier. A colour swatch beside the text so a typo'd hex is visible before submit, and the
 *  native picker for anyone who would rather not type one. */
function TokenInput({ name, value, error, onChange }: { name: TokenKey; value: string; error?: string | undefined; onChange: (v: string) => void }) {
  const valid = HEX.test(value);
  const optional = isOptionalToken(name);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-700">
        {label(name)}
        {optional && <span className="ml-1 font-normal text-gray-400">optional</span>}
      </span>
      <span className="flex items-center gap-2">
        <input
          type="color" value={valid ? value : '#FFFFFF'} onChange={(e) => onChange(e.target.value.toUpperCase())}
          aria-label={`${label(name)} colour picker`}
          className="h-8 w-8 flex-none cursor-pointer rounded border border-gray-300 bg-white p-0.5"
        />
        <input
          value={value} onChange={(e) => onChange(e.target.value)} placeholder={optional ? '—' : '#RRGGBB'}
          aria-label={label(name)} aria-invalid={!!error}
          className={`w-28 rounded-md border px-2 py-1.5 font-mono text-xs ${error ? 'border-red-400' : 'border-gray-300'}`}
        />
      </span>
      {error
        ? <span className="text-[11px] text-red-600">{error}</span>
        : TOKEN_NOTES[name] && <span className="text-[11px] text-gray-400">{TOKEN_NOTES[name]}</span>}
    </label>
  );
}

function Field({ label: l, error, children }: { label: string; error?: string | undefined; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-700">{l}</span>
      {children}
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </label>
  );
}

function Banner({ tone, text, inline }: { tone: 'ok' | 'warn' | 'bad'; text: string; inline?: boolean }) {
  const cls = tone === 'ok' ? 'bg-green-50 text-green-800' : tone === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700';
  return <p role="status" className={`${inline ? 'ml-2' : 'mt-3'} rounded-md px-3 py-2 text-sm ${cls}`}>{text}</p>;
}

/** 'accent650' → 'Accent 650'; 'chromeDeep' → 'Chrome deep'. */
function label(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Start from the live theme, minus the optional tiers (see the header). */
function seed(prefill: Record<string, string>): Values {
  const v: Values = { name: '', version: '1' };
  for (const k of THEME_TOKEN_KEYS) v[k] = isOptionalToken(k) ? '' : (prefill[k] ?? '');
  return v;
}
