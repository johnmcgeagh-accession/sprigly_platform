export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { db, themes } from '@sprigly/db';
import { desc } from 'drizzle-orm';
import { ActivateButton } from './ActivateButton';

interface ContrastRow { pair: string; ratio: number; passesAA: boolean; passesLarge: boolean }

/** The swatches to preview per theme (token key → label). */
const SWATCHES: { key: string; label: string }[] = [
  { key: 'accent600', label: 'Accent 600' }, { key: 'accent700', label: 'Accent 700' },
  { key: 'accent800', label: 'Accent 800' }, { key: 'accent100', label: 'Accent 100' },
  { key: 'chrome', label: 'Chrome' }, { key: 'chromeDeep', label: 'Chrome deep' },
  { key: 'canvas', label: 'Canvas' }, { key: 'surface', label: 'Surface' }, { key: 'line', label: 'Border' },
];

export default async function ThemesPage() {
  const rows = await db
    .select({ id: themes.id, name: themes.name, version: themes.version, tokens: themes.tokens, contrast: themes.contrast, isActive: themes.isActive, createdAt: themes.createdAt })
    .from(themes)
    .orderBy(desc(themes.isActive), desc(themes.version));

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Themes</h1>
      <p className="mb-6 max-w-2xl text-sm text-gray-500">
        Platform-wide design themes — <strong>global, not per-client</strong> (there is no client_id column).
        Exactly one theme is active; the client app resolves its tokens from it (CSS variables injected at
        the layout root — a switch repaints on next load, no deploy). Activation is blocked for a theme whose
        tint/text pairing fails AA.
      </p>

      <div className="flex flex-col gap-5">
        {rows.map((t) => {
          const tokens = (t.tokens ?? {}) as Record<string, string>;
          const contrastRows = ((t.contrast as { rows?: ContrastRow[] })?.rows ?? []) as ContrastRow[];
          return (
            <div key={t.id} className={`rounded-lg border p-5 ${t.isActive ? 'border-green-300 bg-green-50/40' : 'border-gray-200 bg-white'}`}>
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{t.name} <span className="text-sm font-normal text-gray-400">v{t.version}</span></h2>
                  <p className="text-xs text-gray-400">created {new Date(t.createdAt).toISOString().slice(0, 10)}</p>
                </div>
                <ActivateButton id={t.id} active={t.isActive} />
              </div>

              {/* swatches */}
              <div className="mb-4 flex flex-wrap gap-3">
                {SWATCHES.map((s) => (
                  <div key={s.key} className="flex flex-col items-center gap-1">
                    <span className="h-10 w-10 rounded-md border border-gray-200" style={{ background: tokens[s.key] ?? '#fff' }} />
                    <span className="text-[10px] text-gray-500">{s.label}</span>
                    <span className="font-mono text-[10px] text-gray-400">{tokens[s.key] ?? '—'}</span>
                  </div>
                ))}
              </div>

              {/* contrast table */}
              {contrastRows.length > 0 && (
                <table className="w-full text-left text-xs">
                  <thead className="text-gray-400">
                    <tr><th className="py-1 font-medium">Pairing</th><th className="py-1 font-medium">Ratio</th><th className="py-1 font-medium">Verdict</th></tr>
                  </thead>
                  <tbody className="text-gray-700">
                    {contrastRows.map((r, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="py-1 pr-3">{r.pair}</td>
                        <td className="py-1 pr-3 font-mono">{r.ratio}:1</td>
                        <td className="py-1">
                          {r.passesAA
                            ? <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-700">AA</span>
                            : r.passesLarge
                              ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">Large only</span>
                              : <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">Fails</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
