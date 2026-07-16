// Canonical BASE_QUESTIONS — the 5 monthly planning questions sent in the
// content-request email and shown in the manual intake UI.
// Shared between @sprigly/worker (request-email.ts) and @sprigly/web (IntakePanel).

export const BASE_QUESTIONS = [
  'Any key dates next month? Launches, events, deadlines.',
  "Anything new or returning to feature, or anything you'd rather we held back?",
  'Any specific looks, themes, or formats you want this month?',
  "Any stories worth telling? A behind-the-scenes moment, a customer story, something you're proud of.",
  'Anything specific you need driven this month?',
] as const;

export type BaseQuestion = typeof BASE_QUESTIONS[number];

/**
 * The ONE ordered planning-question list for a channel: BASE_QUESTIONS followed by the channel's
 * own extra_questions (client_channels.extra_questions), with the string filter both surfaces
 * already applied. Shared so the card (which counts) and the intake panel (which edits) can never
 * disagree on the set or its order. Returns questions ONLY — it knows nothing about answers,
 * counts, or state. The `extra_questions` column is jsonb, so the value is treated as unknown and
 * non-string entries are dropped (identical to the prior inline guards).
 */
export function questionsForChannel(channel: { extraQuestions?: readonly unknown[] | null }): string[] {
  const extra = Array.isArray(channel.extraQuestions)
    ? channel.extraQuestions.filter((q): q is string => typeof q === 'string')
    : [];
  return [...BASE_QUESTIONS, ...extra];
}
