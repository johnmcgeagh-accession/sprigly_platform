/**
 * intake-completeness.ts — QUESTION C, "how COMPLETE is the form?"
 *
 * Distinct from the has-input questions (intake-signals.ts): C is keyed to the CURRENT question
 * list, so an orphaned answer (to a since-removed question) does NOT count — this measures form
 * progress, not whether input exists. No durable (durable is not a form field).
 *
 * Pure + dependency-free (no @sprigly/db) so it is safe to import into CLIENT components via the
 * `@sprigly/engine/intake-completeness` subpath, exactly like touch-schedule.ts.
 */
export function intakeCompleteness(
  answers: Record<string, string> | null | undefined,
  questions: readonly string[],
): { answered: string[]; total: number } {
  const a = answers ?? {};
  const answered = questions.filter((q) => (a[q] ?? '').trim().length > 0);
  return { answered, total: questions.length };
}
