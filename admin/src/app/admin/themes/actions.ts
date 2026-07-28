'use server';

import { and, eq, desc } from 'drizzle-orm';
import { db, themes } from '@sprigly/db';
import { themeActivatable, computeThemeContrast, type ThemeTokens } from '@sprigly/engine';
import { revalidatePath } from 'next/cache';
import { parseThemeDraft } from '@/lib/theme-draft';

export interface ActivateResult { ok: boolean; error?: string }

export interface CreateResult {
  ok: boolean;
  /** Per-field messages, keyed by input name. Present only when validation failed. */
  errors?: Record<string, string>;
  /** A single message for something the form could not have known — a name clash, a DB failure. */
  error?: string;
  /** Set on success: whether the new theme would pass the activation gate, and why not.
   *  Creation NEVER activates, so this is information, not a refusal. */
  activatable?: boolean;
  gateReason?: string;
}

/**
 * Create a theme. It is stored INACTIVE, always.
 *
 * Creating and activating are two doors on purpose, and this keeps them that way: making a
 * theme is a private act, activating one repaints the product for every client on the next
 * load. The contrast table is computed and stored at insert (exactly as migration 0079 does for
 * the seeded rows) so the list can show the pairings immediately, and the gate verdict is
 * RETURNED rather than enforced — the operator learns straight away that a theme will not
 * activate, without this becoming a second place that can block.
 *
 * The activation gate itself is untouched: still `themeActivatable`, still the one pair
 * (accent-800 on accent-100 ≥ 4.5:1), still only in `activateTheme`.
 */
export async function createTheme(form: Record<string, string>): Promise<CreateResult> {
  const draft = parseThemeDraft(form);
  if (!draft.ok) return { ok: false, errors: draft.errors };

  try {
    // (name, version) carries a unique index. Catching it here means a friendly sentence that
    // names the clash and the next free version, rather than a raw constraint violation.
    const [clash] = await db
      .select({ id: themes.id })
      .from(themes)
      .where(and(eq(themes.name, draft.name), eq(themes.version, draft.version)))
      .limit(1);
    if (clash) {
      const [latest] = await db
        .select({ version: themes.version })
        .from(themes)
        .where(eq(themes.name, draft.name))
        .orderBy(desc(themes.version))
        .limit(1);
      return { ok: false, errors: { version: `${draft.name} v${draft.version} already exists. Try version ${(latest?.version ?? draft.version) + 1}.` } };
    }

    const contrast = computeThemeContrast(draft.tokens);
    await db.insert(themes).values({
      name: draft.name,
      version: draft.version,
      tokens: draft.tokens as unknown as Record<string, string>,
      contrast: contrast as unknown as Record<string, unknown>,
      isActive: false,
    });

    revalidatePath('/admin/themes');
    const verdict = themeActivatable(draft.tokens);
    return { ok: true, activatable: verdict.ok, ...(verdict.reason ? { gateReason: verdict.reason } : {}) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not create the theme.' };
  }
}

/**
 * Activate a theme platform-wide (GLOBAL — there is no client_id). The CONTRAST GATE runs first:
 * a theme whose accent-800-on-accent-100 tint/text pairing fails AA (≥4.5:1) is BLOCKED and never
 * activated. On pass, the fresh contrast table is stored and is_active flipped in ONE transaction —
 * the current active row is deactivated FIRST so the partial unique index (one active) never sees
 * two active at once.
 */
export async function activateTheme(id: string): Promise<ActivateResult> {
  try {
    const [row] = await db.select({ tokens: themes.tokens, name: themes.name }).from(themes).where(eq(themes.id, id)).limit(1);
    if (!row) return { ok: false, error: 'Theme not found.' };

    const verdict = themeActivatable(row.tokens as unknown as ThemeTokens);
    if (!verdict.ok) return { ok: false, error: `Activation blocked — ${verdict.reason}.` };

    await db.transaction(async (tx) => {
      await tx.update(themes).set({ isActive: false }).where(eq(themes.isActive, true));
      await tx.update(themes).set({ isActive: true, contrast: verdict.contrast as unknown as Record<string, unknown> }).where(eq(themes.id, id));
    });
    revalidatePath('/admin/themes');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Activation failed.' };
  }
}
