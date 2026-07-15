'use server';

import { eq } from 'drizzle-orm';
import { db, themes } from '@sprigly/db';
import { themeActivatable, type ThemeTokens } from '@sprigly/engine';
import { revalidatePath } from 'next/cache';

export interface ActivateResult { ok: boolean; error?: string }

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
